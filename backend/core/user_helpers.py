"""User-centric resolution and lifecycle helpers.

This module contains:
- Role resolution (what role does this user have?)
- Capability resolution (what can this user do?)
- Membership bootstrap / self-heal (ensure user has an org context)

These are the behavioral layer for the User model — since the User model
itself is Django's default (thin), all "what is this user / what can they do"
logic lives here.

The dependency flows: rbac.py → user_helpers.py → models.
"""

from django.db import transaction

from core.models import (
    CostCode,
    Organization,
    OrganizationMembership,
    OrganizationMembershipRecord,
    OrganizationRecord,
    RoleTemplate,
)
from core.utils.organization_defaults import build_org_defaults

# ---------------------------------------------------------------------------
# Role constants
# ---------------------------------------------------------------------------

RBAC_ROLE_OWNER = "owner"
RBAC_ROLE_PM = "pm"
RBAC_ROLE_BOOKKEEPING = "bookkeeping"
RBAC_ROLE_WORKER = "worker"
RBAC_ROLE_VIEWER = "viewer"


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def _resolve_user_role(user) -> str:
    """Return the canonical role slug for a user from their active membership."""
    membership = (
        OrganizationMembership.objects.filter(
            user=user,
            status=OrganizationMembership.Status.ACTIVE,
        )
        .only("role")
        .first()
    )
    if membership:
        return membership.role
    return RBAC_ROLE_OWNER


def _resolve_user_capabilities(user, *, membership=None) -> dict:
    """Resolve the effective capability flags for a user.

    Resolution order:
    1. membership.role_template.capability_flags_json (if role_template assigned)
    2. System RoleTemplate matching membership.role slug (fallback)
    3. Per-membership capability_flags_json overrides (merged additively)

    Pass an already-fetched ``membership`` to skip the internal
    ``_ensure_membership`` lookup when the caller already has one.
    """
    if membership is None:
        membership = _ensure_membership(user)
    if not membership:
        return {}
    # Ensure role_template is prefetched if assigned
    if membership.role_template_id:
        membership = (
            OrganizationMembership.objects.select_related("role_template")
            .get(pk=membership.pk)
        )

    if membership.role_template_id:
        base = dict(membership.role_template.capability_flags_json or {})
    else:
        system_template = RoleTemplate.objects.filter(
            is_system=True,
            slug=membership.role,
        ).first()
        base = dict(system_template.capability_flags_json) if system_template else {}

    overrides = membership.capability_flags_json or {}
    if overrides:
        for resource, actions in overrides.items():
            existing = set(base.get(resource, []))
            existing.update(actions)
            base[resource] = sorted(existing)

    return base


def _organization_user_ids(user) -> list[int]:
    """Return all active user IDs in the caller's organization.

    Resolves the user's active membership via ``_ensure_membership``, then
    collects every active member's ``user_id`` from that organization.  The
    caller's own ID is always included (even if their membership row is
    missing or stale — a defensive guard).

    This is the primary scoping primitive for multi-tenant data isolation:
    virtually every queryset in the views layer filters on
    ``created_by_id__in=_organization_user_ids(user)`` to ensure users only
    see records owned by their organization.

    See ``Customer`` model docstring (``models/shared_operations/customers.py``)
    for the full rationale on why org-scoped models use this indirect
    ``created_by`` → membership resolution instead of a direct
    ``organization_id`` FK.
    """
    membership = _ensure_membership(user)
    user_ids = list(
        OrganizationMembership.objects.filter(
            organization_id=membership.organization_id,
            status=OrganizationMembership.Status.ACTIVE,
        ).values_list("user_id", flat=True)
    )
    if user.id not in user_ids:
        user_ids.append(user.id)
    return user_ids


# ---------------------------------------------------------------------------
# Membership bootstrap / self-heal
# ---------------------------------------------------------------------------


def _ensure_membership(user):
    """Return the user's active OrganizationMembership, bootstrapping one if absent.

    If the user has no active membership, this function atomically creates:
    1. An Organization (with bootstrap defaults derived from the user's email).
    2. An OrganizationMembership (role=owner).
    3. Default cost codes for the new organization.
    4. Immutable OrganizationRecord and OrganizationMembershipRecord audit rows.

    This self-heal path fires on first authenticated request for new users
    (login, register, /me) and ensures every authenticated user always has
    an org context. It is also the entry point for _resolve_user_capabilities.
    """
    membership = (
        OrganizationMembership.objects.select_related("organization")
        .filter(
            user=user,
            status=OrganizationMembership.Status.ACTIVE,
        )
        .first()
    )
    if membership:
        return membership

    with transaction.atomic():
        display_name = Organization.derive_name(user)
        bootstrap_defaults = build_org_defaults(
            owner_email=user.email or "",
        )
        organization = Organization.objects.create(
            display_name=display_name,
            **bootstrap_defaults,
            created_by=user,
        )
        OrganizationRecord.record(
            organization=organization,
            event_type=OrganizationRecord.EventType.CREATED,
            capture_source=OrganizationRecord.CaptureSource.AUTH_BOOTSTRAP,
            recorded_by=user,
            note="Organization bootstrap created during auth self-heal.",
            metadata={"bootstrap_reason": "missing_active_membership"},
        )
        bootstrap_role = OrganizationMembership.Role.OWNER
        membership = OrganizationMembership.objects.create(
            organization=organization,
            user=user,
            role=bootstrap_role,
            status=OrganizationMembership.Status.ACTIVE,
        )
        OrganizationMembershipRecord.record(
            membership=membership,
            event_type=OrganizationMembershipRecord.EventType.CREATED,
            capture_source=OrganizationMembershipRecord.CaptureSource.AUTH_BOOTSTRAP,
            recorded_by=user,
            from_status=None,
            to_status=membership.status,
            from_role="",
            to_role=membership.role,
            note="Organization membership bootstrap created during auth self-heal.",
            metadata={"bootstrap_reason": "missing_active_membership"},
        )
        CostCode.seed_defaults(
            organization=organization,
            created_by=user,
        )
    return membership
