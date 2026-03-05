"""Domain-specific helpers for organization management views."""

from django.db.models import Case, Value, When

from core.models import OrganizationMembership
from core.user_helpers import _resolve_user_capabilities, _resolve_user_role

# Hierarchical role ordering: owner first, viewer last.
_ROLE_HIERARCHY = ["owner", "pm", "bookkeeping", "worker", "viewer"]
_ROLE_ORDER_WHENS = [When(role=slug, then=Value(i)) for i, slug in enumerate(_ROLE_HIERARCHY)]


def _organization_role_policy(user) -> dict:
    """Build the role policy dict describing the user's effective permissions for the org console."""
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
    """Return the ordered membership queryset for an organization with user relations loaded.

    Ordering: active before disabled, then hierarchical role order
    (owner → pm → bookkeeping → worker → viewer), then user_id tiebreaker.
    """
    return (
        OrganizationMembership.objects.select_related("user")
        .filter(organization_id=organization_id)
        .annotate(role_order=Case(*_ROLE_ORDER_WHENS, default=Value(99)))
        .order_by("status", "role_order", "user_id")
    )


def _is_last_active_owner(membership: OrganizationMembership, *, next_role: str, next_status: str) -> bool:
    """Return True if changing this membership would leave the organization with no active owner."""
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
