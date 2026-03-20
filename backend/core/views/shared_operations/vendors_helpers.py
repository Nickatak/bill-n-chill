"""Domain-specific helpers for vendor views."""

from django.db.models import Q

from core.models import Vendor
from core.views.helpers import _org_scope_filter  # noqa: F401 — re-exported for vendors.py


def _find_duplicate_vendors(user, *, name: str, email: str, exclude_vendor_id=None):
    """Find existing vendors matching by name or email for duplicate detection."""
    rows = Vendor.objects.filter(_org_scope_filter(user))
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
