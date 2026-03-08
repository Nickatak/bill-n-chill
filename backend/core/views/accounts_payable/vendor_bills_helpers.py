"""Domain-specific helpers for vendor bill views."""

from decimal import Decimal

from core.models import VendorBill, VendorBillLine
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _resolve_cost_codes_for_user, _vendor_scope_filter  # noqa: F401 — re-exported for vendor_bills.py


def _find_duplicate_vendor_bills(
    user,
    *,
    vendor_id: int,
    bill_number: str,
    exclude_vendor_bill_id=None,
):
    """Return same-user vendor bills matching vendor+bill number (case-insensitive)."""
    from core.user_helpers import _ensure_membership

    bill_number_norm = (bill_number or "").strip()
    if not vendor_id or not bill_number_norm:
        return []
    membership = _ensure_membership(user)

    rows = VendorBill.objects.filter(
        project__organization_id=membership.organization_id,
        vendor_id=vendor_id,
        bill_number__iexact=bill_number_norm,
    )
    if exclude_vendor_bill_id:
        rows = rows.exclude(id=exclude_vendor_bill_id)

    return list(rows.select_related("vendor", "project").order_by("-created_at", "-id"))


def _calculate_vendor_bill_line_totals(line_items_data):
    """Compute per-line totals and return normalized items with a running subtotal."""
    subtotal = MONEY_ZERO
    normalized_items = []
    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_price = Decimal(str(item["unit_price"]))
        line_total = quantize_money(quantity * unit_price)
        subtotal = quantize_money(subtotal + line_total)
        normalized_items.append({
            **item,
            "quantity": quantity,
            "unit_price": unit_price,
            "line_total": line_total,
        })
    return normalized_items, subtotal


def _apply_vendor_bill_lines_and_totals(vendor_bill, line_items_data, tax_amount, shipping_amount, user):
    """Replace a vendor bill's line items and recompute all totals.

    Returns an error dict on failure, or None on success.
    Unlike invoices (which use tax_percent), vendor bills store tax_amount
    and shipping_amount as flat values — total = subtotal + tax + shipping.
    """
    normalized_items, subtotal = _calculate_vendor_bill_line_totals(line_items_data)
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_amount = quantize_money(Decimal(str(tax_amount)))
    shipping_amount = quantize_money(Decimal(str(shipping_amount)))
    total = quantize_money(subtotal + tax_amount + shipping_amount)

    vendor_bill.line_items.all().delete()
    new_lines = []
    for item in normalized_items:
        cost_code_id = item.get("cost_code")
        cost_code = code_map.get(cost_code_id) if cost_code_id else None
        new_lines.append(
            VendorBillLine(
                vendor_bill=vendor_bill,
                cost_code=cost_code,
                description=item["description"],
                quantity=item["quantity"],
                unit=item.get("unit", "ea"),
                unit_price=item["unit_price"],
                line_total=item["line_total"],
            )
        )
    VendorBillLine.objects.bulk_create(new_lines)

    vendor_bill.subtotal = subtotal
    vendor_bill.tax_amount = tax_amount
    vendor_bill.shipping_amount = shipping_amount
    vendor_bill.total = total
    vendor_bill.save(
        update_fields=[
            "subtotal",
            "tax_amount",
            "shipping_amount",
            "total",
            "updated_at",
        ]
    )
    return None


def _vendor_bill_line_apply_error_response(apply_error):
    """Convert an _apply_vendor_bill_lines_and_totals error dict into a (body, status) HTTP response tuple."""
    if "missing_cost_codes" in apply_error:
        return (
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more cost codes are invalid for this user.",
                    "fields": {"cost_code": apply_error["missing_cost_codes"]},
                }
            },
            400,
        )
    return (
        {
            "error": {
                "code": "validation_error",
                "message": "Vendor bill line validation failed.",
                "fields": {},
            }
        },
        400,
    )
