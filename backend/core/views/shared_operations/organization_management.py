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
from core.rbac import _capability_gate
from core.user_helpers import _ensure_membership
from core.views.shared_operations.organization_management_helpers import (
    _is_last_active_owner,
    _organization_membership_queryset,
    _organization_role_policy,
)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def organization_profile_view(request):
    """Fetch or patch organization profile for the caller's active membership org."""
    membership = _ensure_membership(request.user)
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

    serializer = OrganizationProfileUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    incoming = serializer.validated_data

    # Field-level capability gates: identity vs presets
    _identity_fields = {"display_name", "billing_address", "phone_number", "website_url", "license_number", "tax_id"}
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
        "billing_address": {"attr": "billing_address", "strip": True},
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


LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB
LOGO_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def organization_logo_upload_view(request):
    """Upload or replace the organization logo image.

    Accepts multipart/form-data with a single ``logo`` file field.
    Validates content type (JPEG, PNG, WebP) and size (2 MB max).
    Gated by ``org_identity.edit`` capability.
    """
    permission_error, _ = _capability_gate(request.user, "org_identity", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_membership(request.user)
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

    organization.logo = logo_file
    organization.save(update_fields=["logo", "updated_at"])

    with transaction.atomic():
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
    """List memberships for caller's active organization scope."""
    membership = _ensure_membership(request.user)
    rows = _organization_membership_queryset(membership.organization_id)
    return Response(
        {
            "data": {
                "memberships": OrganizationMembershipSerializer(
                    rows, many=True, context={"request": request}
                ).data,
                "role_policy": _organization_role_policy(request.user),
            }
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def organization_membership_detail_view(request, membership_id: int):
    """Patch one organization membership's role/status (requires users.edit_role)."""
    permission_error, _ = _capability_gate(request.user, "users", "edit_role")
    if permission_error:
        return Response(permission_error, status=403)

    viewer_membership = _ensure_membership(request.user)
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
