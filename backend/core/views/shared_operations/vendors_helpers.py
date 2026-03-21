"""Domain-specific helpers for vendor views."""

from django.contrib.auth.models import AbstractUser
from django.db.models import Q

from core.models import Vendor
from core.views.helpers import _org_scope_filter  # noqa: F401 — re-exported for vendors.py


def _find_duplicate_vendors(
    user: AbstractUser,
    *,
    name: str,
    exclude_vendor_id: int | None = None,
) -> list[Vendor]:
    """Find org-scoped vendors matching by name for duplicate detection.

    Case-insensitive exact match on name only.  Duplicate vendors are
    blocked outright — there is no override path.  Users must
    differentiate names (e.g. append a location) to create distinct
    vendor records.
    """
    name_norm = (name or "").strip()
    if not name_norm:
        return []

    rows = Vendor.objects.filter(_org_scope_filter(user))
    if exclude_vendor_id:
        rows = rows.exclude(id=exclude_vendor_id)

    return list(rows.filter(name__iexact=name_norm).order_by("id"))
