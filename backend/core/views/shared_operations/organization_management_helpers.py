"""Domain-specific helpers for organization management views."""

from typing import Any

from django.contrib.auth.models import AbstractUser
from django.db.models import Case, QuerySet, Value, When

from core.models import OrganizationMembership
from core.user_helpers import _resolve_user_capabilities, _resolve_user_role


# ---------------------------------------------------------------------------
# Constants (imported by views)
# ---------------------------------------------------------------------------

LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB
LOGO_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}

# Hierarchical role ordering: owner first, viewer last.
_ROLE_HIERARCHY = ["owner", "pm", "bookkeeping", "worker", "viewer"]
_ROLE_ORDER_WHENS = [When(role=slug, then=Value(i)) for i, slug in enumerate(_ROLE_HIERARCHY)]


# ---------------------------------------------------------------------------
# Role policy
# ---------------------------------------------------------------------------


def _organization_role_policy(user: AbstractUser) -> dict[str, Any]:
    """Build the role policy dict describing the user's effective permissions.

    Returns a dict consumed by the frontend org console to gate UI elements
    (edit buttons, role dropdowns, invite controls).  Includes the user's
    effective role, per-section edit flags, and the full list of assignable
    roles and statuses.
    """
    effective_role = _resolve_user_role(user)
    capabilities = _resolve_user_capabilities(user)
    can_edit_identity = "edit" in capabilities.get("org_identity", [])
    can_edit_presets = "edit" in capabilities.get("org_presets", [])
    can_manage_memberships = "edit_role" in capabilities.get("users", [])
    can_invite = "invite" in capabilities.get("users", [])
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


# ---------------------------------------------------------------------------
# Membership queries
# ---------------------------------------------------------------------------


def _organization_membership_queryset(organization_id: int) -> QuerySet:
    """Return the ordered membership queryset for an organization.

    Loads the related ``user`` and annotates with ``role_order`` for
    hierarchical sorting: active before disabled, then role hierarchy
    (owner -> pm -> bookkeeping -> worker -> viewer), then ``user_id``
    tiebreaker.
    """
    return (
        OrganizationMembership.objects.select_related("user")
        .filter(organization_id=organization_id)
        .annotate(role_order=Case(*_ROLE_ORDER_WHENS, default=Value(99)))
        .order_by("status", "role_order", "user_id")
    )


def _is_last_active_owner(
    membership: OrganizationMembership,
    *,
    next_role: str,
    next_status: str,
) -> bool:
    """Return True if changing this membership would leave the org with no active owner.

    Checks whether the membership is currently an active owner, whether the
    proposed change would remove that status, and whether any other active
    owners exist.  Used as a guard in ``organization_membership_detail_view``
    to prevent orphaning an organization.
    """
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
