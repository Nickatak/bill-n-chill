"""Domain-specific helpers for vendor-bill views."""

from django.db.models import Sum

from core.models import BudgetLine, VendorBill, VendorBillAllocation
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _organization_user_ids
from core.views.helpers import _vendor_scope_filter  # noqa: F401 — re-exported for vendor_bills.py


def _find_duplicate_vendor_bills(
    user,
    *,
    vendor_id: int,
    bill_number: str,
    exclude_vendor_bill_id=None,
):
    """Return same-user vendor bills matching vendor+bill number (case-insensitive)."""
    bill_number_norm = (bill_number or "").strip()
    if not vendor_id or not bill_number_norm:
        return []
    actor_user_ids = _organization_user_ids(user)

    rows = VendorBill.objects.filter(
        created_by_id__in=actor_user_ids,
        vendor_id=vendor_id,
        bill_number__iexact=bill_number_norm,
    )
    if exclude_vendor_bill_id:
        rows = rows.exclude(id=exclude_vendor_bill_id)

    return list(rows.select_related("vendor", "project").order_by("-created_at", "-id"))


def _allocation_total(*, vendor_bill):
    """Return the quantized sum of allocations currently attached to a vendor bill."""
    total = (
        VendorBillAllocation.objects.filter(vendor_bill=vendor_bill).aggregate(sum=Sum("amount"))["sum"]
        or MONEY_ZERO
    )
    return quantize_money(total)


def _validate_allocation_budget_lines(*, project, user, allocations):
    """Resolve allocation budget lines scoped to the same project and owner."""
    budget_line_ids = [entry["budget_line"] for entry in allocations]
    if not budget_line_ids:
        return {}
    actor_user_ids = _organization_user_ids(user)
    rows = BudgetLine.objects.filter(
        id__in=budget_line_ids,
        budget__project=project,
        budget__created_by_id__in=actor_user_ids,
    ).select_related("budget")
    return {row.id: row for row in rows}


def _sync_vendor_bill_allocations(*, vendor_bill, allocations):
    """Replace all allocations for a vendor bill with the provided allocation set."""
    VendorBillAllocation.objects.filter(vendor_bill=vendor_bill).delete()
    if not allocations:
        return
    VendorBillAllocation.objects.bulk_create(
        [
            VendorBillAllocation(
                vendor_bill=vendor_bill,
                budget_line_id=entry["budget_line"],
                amount=entry["amount"],
                note=entry.get("note", ""),
            )
            for entry in allocations
        ]
    )
