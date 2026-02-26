"""Organization profile and RBAC membership management endpoints."""

from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Organization, OrganizationMembership, OrganizationMembershipRecord, OrganizationRecord
from core.serializers.organization_management import (
    OrganizationMembershipSerializer,
    OrganizationMembershipUpdateSerializer,
    OrganizationProfileSerializer,
    OrganizationProfileUpdateSerializer,
)
from core.views.helpers import (
    _ensure_primary_membership,
    _record_organization_membership_record,
    _record_organization_record,
    _resolve_user_role,
    _role_gate_error_payload,
)


def _organization_role_policy(user) -> dict:
    effective_role = _resolve_user_role(user)
    can_edit_profile = effective_role in {"owner", "pm"}
    can_manage_memberships = effective_role == "owner"
    return {
        "effective_role": effective_role,
        "can_edit_profile": can_edit_profile,
        "can_manage_memberships": can_manage_memberships,
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

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = OrganizationProfileUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    incoming = serializer.validated_data

    update_fields = ["updated_at"]
    changed_fields: list[str] = []
    next_display_name = organization.display_name
    next_slug = organization.slug
    if "display_name" in incoming:
        display_name = str(incoming["display_name"]).strip()
        if display_name != organization.display_name:
            next_display_name = display_name
            changed_fields.append("display_name")
            update_fields.append("display_name")

    if "slug" in incoming:
        raw_slug = incoming.get("slug")
        slug_value = str(raw_slug).strip() if raw_slug is not None else ""
        normalized_slug = slug_value or None
        if normalized_slug is not None and Organization.objects.filter(slug=normalized_slug).exclude(
            id=organization.id
        ).exists():
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Organization slug must be unique.",
                        "fields": {"slug": ["This slug is already in use by another organization."]},
                    }
                },
                status=400,
            )
        if normalized_slug != organization.slug:
            next_slug = normalized_slug
            changed_fields.append("slug")
            update_fields.append("slug")

    if "logo_url" in incoming:
        logo_url = str(incoming.get("logo_url") or "").strip()
        if logo_url != organization.logo_url:
            organization.logo_url = logo_url
            changed_fields.append("logo_url")
            update_fields.append("logo_url")

    if "invoice_sender_name" in incoming:
        sender_name = str(incoming.get("invoice_sender_name") or "").strip()
        if sender_name != organization.invoice_sender_name:
            organization.invoice_sender_name = sender_name
            changed_fields.append("invoice_sender_name")
            update_fields.append("invoice_sender_name")

    if "invoice_sender_email" in incoming:
        sender_email = str(incoming.get("invoice_sender_email") or "").strip()
        if sender_email != organization.invoice_sender_email:
            organization.invoice_sender_email = sender_email
            changed_fields.append("invoice_sender_email")
            update_fields.append("invoice_sender_email")

    if "invoice_sender_address" in incoming:
        sender_address = str(incoming.get("invoice_sender_address") or "").strip()
        if sender_address != organization.invoice_sender_address:
            organization.invoice_sender_address = sender_address
            changed_fields.append("invoice_sender_address")
            update_fields.append("invoice_sender_address")

    if "invoice_default_due_days" in incoming:
        due_days = int(incoming.get("invoice_default_due_days") or 30)
        if due_days != organization.invoice_default_due_days:
            organization.invoice_default_due_days = due_days
            changed_fields.append("invoice_default_due_days")
            update_fields.append("invoice_default_due_days")

    if "estimate_validation_delta_days" in incoming:
        validation_delta_days = int(incoming.get("estimate_validation_delta_days") or 30)
        if validation_delta_days != organization.estimate_validation_delta_days:
            organization.estimate_validation_delta_days = validation_delta_days
            changed_fields.append("estimate_validation_delta_days")
            update_fields.append("estimate_validation_delta_days")

    if "invoice_default_terms" in incoming:
        default_terms = str(incoming.get("invoice_default_terms") or "").strip()
        if default_terms != organization.invoice_default_terms:
            organization.invoice_default_terms = default_terms
            changed_fields.append("invoice_default_terms")
            update_fields.append("invoice_default_terms")

    if "estimate_default_terms" in incoming:
        estimate_default_terms = str(incoming.get("estimate_default_terms") or "").strip()
        if estimate_default_terms != organization.estimate_default_terms:
            organization.estimate_default_terms = estimate_default_terms
            changed_fields.append("estimate_default_terms")
            update_fields.append("estimate_default_terms")

    if "change_order_default_reason" in incoming:
        change_order_default_reason = str(incoming.get("change_order_default_reason") or "").strip()
        if change_order_default_reason != organization.change_order_default_reason:
            organization.change_order_default_reason = change_order_default_reason
            changed_fields.append("change_order_default_reason")
            update_fields.append("change_order_default_reason")

    if "invoice_default_footer" in incoming:
        default_footer = str(incoming.get("invoice_default_footer") or "").strip()
        if default_footer != organization.invoice_default_footer:
            organization.invoice_default_footer = default_footer
            changed_fields.append("invoice_default_footer")
            update_fields.append("invoice_default_footer")

    if "invoice_default_notes" in incoming:
        default_notes = str(incoming.get("invoice_default_notes") or "").strip()
        if default_notes != organization.invoice_default_notes:
            organization.invoice_default_notes = default_notes
            changed_fields.append("invoice_default_notes")
            update_fields.append("invoice_default_notes")

    if changed_fields:
        with transaction.atomic():
            organization.display_name = next_display_name
            organization.slug = next_slug
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
    """Patch one organization membership's role/status (owner-only)."""
    permission_error, _ = _role_gate_error_payload(request.user, {"owner"})
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
