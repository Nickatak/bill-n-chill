"""Organization profile and RBAC membership management endpoints."""

from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import OrganizationMembership, OrganizationMembershipRecord, OrganizationRecord
from core.serializers.organization_management import (
    OrganizationMembershipSerializer,
    OrganizationMembershipUpdateSerializer,
    OrganizationProfileSerializer,
    OrganizationProfileUpdateSerializer,
)
from core.views.helpers import _capability_gate, _ensure_org_membership
from core.views.shared_operations.organization_management_helpers import (
    LOGO_ALLOWED_CONTENT_TYPES,
    LOGO_MAX_SIZE_BYTES,
    _is_last_active_owner,
    _organization_membership_queryset,
    _organization_role_policy,
)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def organization_profile_view(request):
    """Fetch or update the organization profile for the caller's org.

    GET returns the full profile, current membership, active member count,
    and role policy.  PATCH applies partial updates with field-level capability
    gates: identity fields require ``org_identity.edit``, preset fields require
    ``org_presets.edit``.  Only actually-changed fields are persisted.

    Flow (GET):
        1. Look up org via membership.
        2. Return profile, current membership, member count, and role policy.

    Flow (PATCH):
        1. Validate incoming fields via serializer.
        2. Gate identity fields (``org_identity.edit``) and preset fields
           (``org_presets.edit``) separately.
        3. Diff each field against current value — only persist changes.
        4. If anything changed, save + append ``OrganizationRecord`` (atomic).
        5. Return updated profile with changed_fields metadata.

    URL: ``GET/PATCH /api/v1/organization/profile/``

    Request body (PATCH)::

        { "display_name": "Acme Construction", "help_email": "support@acme.com" }

    Success 200 (GET)::

        { "data": { "organization": {...}, "current_membership": {...}, "active_member_count": 5, "role_policy": {...} } }

    Success 200 (PATCH)::

        { "data": { "organization": {...}, "role_policy": {...} }, "meta": { "changed_fields": ["display_name"] } }

    Errors:
        - 400: Validation error.
        - 403: Missing required capability for the fields being changed.
    """
    membership = _ensure_org_membership(request.user)
    organization = membership.organization

    if request.method == "GET":
        profile_payload = OrganizationProfileSerializer(organization, context={"request": request}).data
        current_membership_payload = OrganizationMembershipSerializer(
            membership, context={"request": request}
        ).data
        active_member_count = _organization_membership_queryset(organization.id).filter(
            status=OrganizationMembership.Status.ACTIVE
        ).count()
        return Response(
            {
                "data": {
                    "organization": profile_payload,
                    "current_membership": current_membership_payload,
                    "active_member_count": active_member_count,
                    "role_policy": _organization_role_policy(request.user),
                }
            }
        )

    elif request.method == "PATCH":
        serializer = OrganizationProfileUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        incoming = serializer.validated_data

        # Field-level capability gates: identity vs presets
        _identity_fields = {
            "display_name", "billing_street_1", "billing_street_2",
            "billing_city", "billing_state", "billing_zip",
            "phone_number", "website_url", "license_number", "tax_id",
        }
        _preset_fields = {
            "help_email", "default_invoice_due_delta", "default_estimate_valid_delta",
            "invoice_terms_and_conditions", "estimate_terms_and_conditions",
            "change_order_terms_and_conditions",
        }
        if _identity_fields & incoming.keys():
            permission_error, _ = _capability_gate(request.user, "org_identity", "edit")
            if permission_error:
                return Response(permission_error, status=403)
        if _preset_fields & incoming.keys():
            permission_error, _ = _capability_gate(request.user, "org_presets", "edit")
            if permission_error:
                return Response(permission_error, status=403)

        update_fields = ["updated_at"]
        changed_fields: list[str] = []

        # Simple string fields: check each for change and stage update
        _string_fields = {
            "display_name": {"attr": "display_name", "strip": True, "allow_blank": False},
            "help_email": {"attr": "help_email", "strip": True},
            "billing_street_1": {"attr": "billing_street_1", "strip": True},
            "billing_street_2": {"attr": "billing_street_2", "strip": True},
            "billing_city": {"attr": "billing_city", "strip": True},
            "billing_state": {"attr": "billing_state", "strip": True},
            "billing_zip": {"attr": "billing_zip", "strip": True},
            "phone_number": {"attr": "phone_number", "strip": True},
            "website_url": {"attr": "website_url", "strip": True},
            "license_number": {"attr": "license_number", "strip": True},
            "tax_id": {"attr": "tax_id", "strip": True},
            "invoice_terms_and_conditions": {"attr": "invoice_terms_and_conditions", "strip": True},
            "estimate_terms_and_conditions": {"attr": "estimate_terms_and_conditions", "strip": True},
            "change_order_terms_and_conditions": {"attr": "change_order_terms_and_conditions", "strip": True},
        }
        for field_name, opts in _string_fields.items():
            if field_name not in incoming:
                continue
            value = str(incoming.get(field_name) or "").strip() if opts.get("strip") else str(incoming.get(field_name) or "")
            if value != getattr(organization, opts["attr"]):
                setattr(organization, opts["attr"], value)
                changed_fields.append(field_name)
                update_fields.append(opts["attr"])

        # Integer fields
        _int_fields = {
            "default_invoice_due_delta": "default_invoice_due_delta",
            "default_estimate_valid_delta": "default_estimate_valid_delta",
        }
        for field_name, attr in _int_fields.items():
            if field_name not in incoming:
                continue
            value = int(incoming.get(field_name) or 30)
            if value != getattr(organization, attr):
                setattr(organization, attr, value)
                changed_fields.append(field_name)
                update_fields.append(attr)

        if changed_fields:
            with transaction.atomic():
                organization.save(update_fields=update_fields)
                OrganizationRecord.record(
                    organization=organization,
                    event_type=OrganizationRecord.EventType.UPDATED,
                    capture_source=OrganizationRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    note="Organization profile updated from management surface.",
                    metadata={"changed_fields": changed_fields},
                )

        return Response(
            {
                "data": {
                    "organization": OrganizationProfileSerializer(organization, context={"request": request}).data,
                    "role_policy": _organization_role_policy(request.user),
                },
                "meta": {"changed_fields": changed_fields},
            }
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def complete_onboarding_view(request):
    """Mark the caller's organization onboarding as completed.

    One-way flag — once set to ``True`` it stays ``True``.  No RBAC gate
    because any authenticated member completing onboarding benefits the org.

    Flow:
        1. Look up org via membership.
        2. If not already completed, set flag and save.

    URL: ``POST /api/v1/organization/complete-onboarding/``

    Request body: (none)

    Success 200::

        { "data": { "onboarding_completed": true } }
    """
    membership = _ensure_org_membership(request.user)
    org = membership.organization
    if not org.onboarding_completed:
        org.onboarding_completed = True
        org.save(update_fields=["onboarding_completed", "updated_at"])
    return Response({"data": {"onboarding_completed": True}})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def organization_logo_upload_view(request):
    """Upload or replace the organization logo image.

    Accepts ``multipart/form-data`` with a single ``logo`` file field.
    Validates content type (JPEG, PNG, WebP) and size (2 MB max).  If a
    previous logo exists, it is deleted before saving the new one.

    Flow:
        1. Capability gate: ``org_identity.edit``.
        2. Validate file presence, content type, and size.
        3. Delete previous logo file if one exists.
        4. Save new logo + append ``OrganizationRecord`` (atomic).

    URL: ``POST /api/v1/organization/logo/``

    Request body: ``multipart/form-data`` with ``logo`` file field.

    Success 200::

        { "data": { "organization": { ... } } }

    Errors:
        - 400: No file provided, unsupported content type, or file too large.
        - 403: Missing ``org_identity.edit`` capability.
    """
    permission_error, _ = _capability_gate(request.user, "org_identity", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_org_membership(request.user)
    organization = membership.organization

    logo_file = request.FILES.get("logo")
    if not logo_file:
        return Response(
            {"error": {"code": "validation_error", "message": "No logo file provided.", "fields": {}}},
            status=400,
        )

    if logo_file.content_type not in LOGO_ALLOWED_CONTENT_TYPES:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Unsupported file type: {logo_file.content_type}. Use JPEG, PNG, or WebP.",
                    "fields": {},
                }
            },
            status=400,
        )

    if logo_file.size > LOGO_MAX_SIZE_BYTES:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Logo file exceeds 2 MB size limit.",
                    "fields": {},
                }
            },
            status=400,
        )

    # Delete the previous logo file if one exists.
    if organization.logo:
        organization.logo.delete(save=False)

    with transaction.atomic():
        organization.logo = logo_file
        organization.save(update_fields=["logo", "updated_at"])

        OrganizationRecord.record(
            organization=organization,
            event_type=OrganizationRecord.EventType.UPDATED,
            capture_source=OrganizationRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            note="Organization logo uploaded.",
            metadata={"changed_fields": ["logo"]},
        )

    return Response(
        {
            "data": {
                "organization": OrganizationProfileSerializer(
                    organization, context={"request": request}
                ).data,
            }
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def organization_memberships_view(request):
    """List memberships for the caller's organization.

    Returns all memberships ordered hierarchically (active owners first),
    plus the role policy for frontend UI gating.

    Flow:
        1. Look up org via membership.
        2. Fetch ordered membership queryset.
        3. Return serialized memberships + role policy.

    URL: ``GET /api/v1/organization/memberships/``

    Request body: (none)

    Success 200::

        { "data": { "memberships": [{ ... }, ...], "role_policy": { ... } } }
    """
    membership = _ensure_org_membership(request.user)
    memberships = _organization_membership_queryset(membership.organization_id)
    return Response(
        {
            "data": {
                "memberships": OrganizationMembershipSerializer(
                    memberships, many=True, context={"request": request}
                ).data,
                "role_policy": _organization_role_policy(request.user),
            }
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def organization_membership_detail_view(request, membership_id):
    """Update a membership's role or status (requires ``users.edit_role``).

    Enforces self-edit guards (can't disable yourself or downgrade your own
    role) and last-active-owner protection (org must always have at least one
    active owner).  Changes are atomic with immutable audit records.

    Flow:
        1. Capability gate: ``users.edit_role``.
        2. Look up membership scoped to user's org.
        3. Validate incoming role/status via serializer.
        4. Reject self-disable and self-role-downgrade.
        5. Reject if change would leave org with no active owner.
        6. If anything changed, save + append audit records (atomic).

    URL: ``PATCH /api/v1/organization/memberships/<membership_id>/``

    Request body::

        { "role": "pm", "status": "active" }

    Success 200::

        { "data": { "membership": { ... }, "role_policy": { ... } }, "meta": { "changed_fields": [...] } }

    Errors:
        - 400: Self-edit violation or last-active-owner protection.
        - 403: Missing ``users.edit_role`` capability.
        - 404: Membership not found.
    """
    permission_error, _ = _capability_gate(request.user, "users", "edit_role")
    if permission_error:
        return Response(permission_error, status=403)

    viewer_membership = _ensure_org_membership(request.user)
    try:
        membership = _organization_membership_queryset(viewer_membership.organization_id).get(
            id=membership_id
        )
    except OrganizationMembership.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Organization membership not found.", "fields": {}}},
            status=404,
        )

    serializer = OrganizationMembershipUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    incoming = serializer.validated_data

    previous_role = membership.role
    previous_status = membership.status
    next_role = incoming.get("role", membership.role)
    next_status = incoming.get("status", membership.status)

    if membership.user_id == request.user.id and next_status != OrganizationMembership.Status.ACTIVE:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "You cannot disable your own active membership.",
                    "fields": {"status": ["Self-disable is not allowed."]},
                }
            },
            status=400,
        )

    if membership.user_id == request.user.id and next_role != OrganizationMembership.Role.OWNER:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "You cannot change your own role from owner on this surface.",
                    "fields": {"role": ["Self-role downgrade is not allowed."]},
                }
            },
            status=400,
        )

    if _is_last_active_owner(membership, next_role=next_role, next_status=next_status):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one active owner must remain in the organization.",
                    "fields": {
                        "role": ["Cannot remove owner privileges from the last active owner."],
                        "status": ["Cannot disable the last active owner."],
                    },
                }
            },
            status=400,
        )

    changed_fields: list[str] = []
    update_fields = ["updated_at"]
    role_changed = next_role != previous_role
    status_changed = next_status != previous_status
    if role_changed:
        changed_fields.append("role")
        update_fields.append("role")
    if status_changed:
        changed_fields.append("status")
        update_fields.append("status")

    if changed_fields:
        with transaction.atomic():
            membership.role = next_role
            membership.status = next_status
            membership.save(update_fields=update_fields)

            if role_changed:
                OrganizationMembershipRecord.record(
                    membership=membership,
                    event_type=OrganizationMembershipRecord.EventType.ROLE_CHANGED,
                    capture_source=OrganizationMembershipRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    from_status=previous_status,
                    to_status=membership.status,
                    from_role=previous_role,
                    to_role=membership.role,
                    note="Membership role updated from organization management surface.",
                    metadata={"changed_field": "role"},
                )
            if status_changed:
                OrganizationMembershipRecord.record(
                    membership=membership,
                    event_type=OrganizationMembershipRecord.EventType.STATUS_CHANGED,
                    capture_source=OrganizationMembershipRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    from_status=previous_status,
                    to_status=membership.status,
                    from_role=previous_role,
                    to_role=membership.role,
                    note="Membership status updated from organization management surface.",
                    metadata={"changed_field": "status"},
                )

    return Response(
        {
            "data": {
                "membership": OrganizationMembershipSerializer(
                    membership, context={"request": request}
                ).data,
                "role_policy": _organization_role_policy(request.user),
            },
            "meta": {"changed_fields": changed_fields},
        }
    )
