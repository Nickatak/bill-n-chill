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
from core.views.helpers import (
    _capability_gate,
    _ensure_primary_membership,
    _record_organization_membership_record,
    _record_organization_record,
    _resolve_user_capabilities,
    _resolve_user_role,
)


def _organization_role_policy(user) -> dict:
    effective_role = _resolve_user_role(user)
    caps = _resolve_user_capabilities(user)
    can_edit_identity = "edit" in caps.get("org_identity", [])
    can_edit_presets = "edit" in caps.get("org_presets", [])
    can_manage_memberships = "edit_role" in caps.get("users", [])
    can_invite = "invite" in caps.get("users", [])
    return {
        "effective_role": effective_role,
        "can_edit_identity": can_edit_identity,
        "can_edit_presets": can_edit_presets,
        "can_edit_profile": can_edit_identity or can_edit_presets,
        "can_manage_memberships": can_manage_memberships,
        "can_invite": can_invite,
        "editable_roles": [choice[0] for choice in OrganizationMembership.Role.choices],
        "editable_statuses": [choice[0] for choice in OrganizationMembership.Status.choices],
    }


def _organization_membership_queryset(organization_id: int):
    return OrganizationMembership.objects.select_related("user").filter(
        organization_id=organization_id
    ).order_by("status", "role", "user_id")


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def organization_profile_view(request):
    """Fetch or patch organization profile for the caller's active membership org."""
    membership = _ensure_primary_membership(request.user)
    organization = membership.organization

    if request.method == "GET":
        profile_payload = OrganizationProfileSerializer(organization).data
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
    _identity_fields = {"display_name", "logo_url", "billing_address"}
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
        "logo_url": {"attr": "logo_url", "strip": True},
        "help_email": {"attr": "help_email", "strip": True},
        "billing_address": {"attr": "billing_address", "strip": True},
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
            _record_organization_record(
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
                "organization": OrganizationProfileSerializer(organization).data,
                "role_policy": _organization_role_policy(request.user),
            },
            "meta": {"changed_fields": changed_fields},
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def organization_memberships_view(request):
    """List memberships for caller's active organization scope."""
    membership = _ensure_primary_membership(request.user)
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


def _is_last_active_owner(membership: OrganizationMembership, *, next_role: str, next_status: str) -> bool:
    is_owner_now = membership.role == OrganizationMembership.Role.OWNER
    is_active_now = membership.status == OrganizationMembership.Status.ACTIVE
    remains_active_owner = (
        next_role == OrganizationMembership.Role.OWNER
        and next_status == OrganizationMembership.Status.ACTIVE
    )
    if not (is_owner_now and is_active_now):
        return False
    if remains_active_owner:
        return False
    has_other_active_owner = OrganizationMembership.objects.filter(
        organization_id=membership.organization_id,
        role=OrganizationMembership.Role.OWNER,
        status=OrganizationMembership.Status.ACTIVE,
    ).exclude(id=membership.id).exists()
    return not has_other_active_owner


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def organization_membership_detail_view(request, membership_id: int):
    """Patch one organization membership's role/status (requires users.edit_role)."""
    permission_error, _ = _capability_gate(request.user, "users", "edit_role")
    if permission_error:
        return Response(permission_error, status=403)

    viewer_membership = _ensure_primary_membership(request.user)
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
                _record_organization_membership_record(
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
                _record_organization_membership_record(
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
