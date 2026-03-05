"""Domain-specific helpers for vendor views."""

from django.db.models import Q

from core.models import Vendor
from core.views.helpers import _ensure_membership, _organization_user_ids


def _vendor_scope_filter(user):
    membership = _ensure_membership(user)
    actor_user_ids = _organization_user_ids(user)
    return Q(organization__isnull=True, is_canonical=True) | Q(organization_id=membership.organization_id) | Q(
        organization__isnull=True,
        created_by_id__in=actor_user_ids,
    )


def _find_duplicate_vendors(user, *, name: str, email: str, exclude_vendor_id=None):
    rows = Vendor.objects.filter(_vendor_scope_filter(user))
    if exclude_vendor_id:
        rows = rows.exclude(id=exclude_vendor_id)

    name_norm = (name or "").strip()
    email_norm = (email or "").strip().lower()
    query = Q()
    if name_norm:
        query |= Q(name__iexact=name_norm)
    if email_norm:
        query |= Q(email__iexact=email_norm)

    if not query:
        return []
    return list(rows.filter(query).order_by("name", "id"))
