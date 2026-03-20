"""Domain-specific helpers for vendor bill views."""

from decimal import Decimal

from django.db import transaction
from rest_framework.response import Response

from core.models import VendorBill, VendorBillLine, VendorBillSnapshot
from core.serializers import VendorBillSerializer
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _resolve_cost_codes_for_user


def _find_duplicate_vendor_bills(
    user,
    *,
    vendor_id: int,
    bill_number: str,
    exclude_vendor_bill_id=None,
):
    """Return same-user vendor bills matching vendor+bill number (case-insensitive)."""
    from core.user_helpers import _ensure_org_membership

    bill_number_norm = (bill_number or "").strip()
    if not vendor_id or not bill_number_norm:
        return []
    membership = _ensure_org_membership(user)

    rows = VendorBill.objects.filter(
        project__organization_id=membership.organization_id,
        vendor_id=vendor_id,
        bill_number__iexact=bill_number_norm,
    )
    if exclude_vendor_bill_id:
        rows = rows.exclude(id=exclude_vendor_bill_id)

    return list(rows.select_related("vendor", "project").order_by("-created_at", "-id"))


def _calculate_vendor_bill_line_totals(line_items_data):
    """Compute per-line amounts (quantity × unit_price) and return normalized items with a running subtotal."""
    subtotal = MONEY_ZERO
    normalized_items = []
    for item in line_items_data:
        quantity = Decimal(str(item.get("quantity", 1)))
        unit_price = quantize_money(Decimal(str(item["unit_price"])))
        amount = quantize_money(quantity * unit_price)
        subtotal = quantize_money(subtotal + amount)
        normalized_items.append({
            **item,
            "quantity": quantity,
            "unit_price": unit_price,
            "amount": amount,
        })
    return normalized_items, subtotal


def _apply_vendor_bill_lines_and_totals(vendor_bill, line_items_data, tax_amount, shipping_amount, user):
    """Replace a vendor bill's line items and recompute all totals.

    Returns an error dict on failure, or None on success.
    Line items are quantity × unit_price transcriptions with optional cost code tags.
    Total = subtotal (sum of line amounts) + tax + shipping.
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
                description=item.get("description", ""),
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                amount=item["amount"],  # pre-computed; bulk_create bypasses save()
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


def _prefetch_vendor_bill_qs(qs):
    """Apply standard select/prefetch for vendor bill queries."""
    return qs.select_related("project", "vendor").prefetch_related(
        "line_items", "line_items__cost_code",
        "target_payments",
    )


# Statuses that require issue_date and due_date.
DATE_REQUIRED_STATUSES = {
    VendorBill.Status.RECEIVED,
    VendorBill.Status.APPROVED,
}

# Statuses that trigger snapshot capture on transition.
SNAPSHOT_CAPTURE_STATUSES = {
    VendorBill.Status.RECEIVED,
    VendorBill.Status.APPROVED,
    VendorBill.Status.DISPUTED,
    VendorBill.Status.CLOSED,
    VendorBill.Status.VOID,
}


# ---------------------------------------------------------------------------
# PATCH concern handlers — called by the thin dispatcher in vendor_bills.py
# ---------------------------------------------------------------------------


def _handle_vb_document_save(request, vendor_bill, data):
    """Apply field updates, line items, and totals to a vendor bill (the 'save' concern).

    Handles vendor, dates, amounts, notes, status echo, line items, and
    totals recomputation.  Does not perform status transitions or snapshot recording.
    """
    next_status = data.get("status", vendor_bill.status)

    # Date validation
    next_issue_date = data.get("issue_date", vendor_bill.issue_date)
    next_due_date = data.get("due_date", vendor_bill.due_date)
    if next_status in DATE_REQUIRED_STATUSES:
        fields = {}
        if next_issue_date is None:
            fields["issue_date"] = ["Issue date is required."]
        if next_due_date is None:
            fields["due_date"] = ["Due date is required."]
        if fields:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Missing required date fields for the selected status.",
                        "fields": fields,
                    }
                },
                status=400,
            )
    if next_due_date and next_issue_date and next_due_date < next_issue_date:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "due_date cannot be before issue_date.",
                    "fields": {"due_date": ["Due date must be on or after issue date."]},
                }
            },
            status=400,
        )

    # Line item validation
    line_items = data.get("line_items")
    has_line_items = line_items is not None
    if has_line_items and not line_items:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one line item is required.",
                    "fields": {"line_items": ["At least one line item is required."]},
                }
            },
            status=400,
        )

    # Field updates
    update_fields = ["updated_at"]
    if "vendor" in data:
        vendor_bill.vendor_id = data["vendor"]
        update_fields.append("vendor")
    if "bill_number" in data:
        vendor_bill.bill_number = data["bill_number"]
        update_fields.append("bill_number")
    if "received_date" in data:
        vendor_bill.received_date = data["received_date"]
        update_fields.append("received_date")
    if "issue_date" in data:
        vendor_bill.issue_date = data["issue_date"]
        update_fields.append("issue_date")
    if "due_date" in data:
        vendor_bill.due_date = data["due_date"]
        update_fields.append("due_date")
    if "notes" in data:
        vendor_bill.notes = data["notes"]
        update_fields.append("notes")
    if "status" in data:
        vendor_bill.status = data["status"]
        update_fields.append("status")

    with transaction.atomic():
        if len(update_fields) > 1:
            vendor_bill.save(update_fields=update_fields)

        if has_line_items:
            next_tax = quantize_money(data.get("tax_amount", vendor_bill.tax_amount))
            next_shipping = quantize_money(data.get("shipping_amount", vendor_bill.shipping_amount))
            apply_error = _apply_vendor_bill_lines_and_totals(
                vendor_bill, line_items, next_tax, next_shipping, request.user,
            )
            if apply_error:
                transaction.set_rollback(True)
                payload, status_code = _vendor_bill_line_apply_error_response(apply_error)
                return Response(payload, status=status_code)
        elif "tax_amount" in data or "shipping_amount" in data:
            existing_lines = [
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit_price": line.unit_price,
                }
                for line in vendor_bill.line_items.all()
            ]
            if existing_lines:
                next_tax = quantize_money(data.get("tax_amount", vendor_bill.tax_amount))
                next_shipping = quantize_money(data.get("shipping_amount", vendor_bill.shipping_amount))
                _apply_vendor_bill_lines_and_totals(
                    vendor_bill, existing_lines, next_tax, next_shipping, request.user,
                )

        # balance_due is now purely driven by payment allocations, not status.
        # No balance recomputation on save — that happens in the allocation flow.

    vendor_bill = _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
    return Response(
        {"data": VendorBillSerializer(vendor_bill).data, "meta": {"duplicate_override_used": False}}
    )


def _handle_vb_status_transition(
    request, vendor_bill, data, previous_status, next_status,
):
    """Handle a vendor bill status transition: validate, apply, snapshot.

    Called when the PATCH includes a real status change (previous != next).
    Document lifecycle only — no payment/balance logic.
    """
    if not VendorBill.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid vendor bill status transition: {previous_status} -> {next_status}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    # Date validation
    next_issue_date = data.get("issue_date", vendor_bill.issue_date)
    next_due_date = data.get("due_date", vendor_bill.due_date)
    if next_status in DATE_REQUIRED_STATUSES:
        fields = {}
        if next_issue_date is None:
            fields["issue_date"] = ["Issue date is required."]
        if next_due_date is None:
            fields["due_date"] = ["Due date is required."]
        if fields:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Missing required date fields for the selected status.",
                        "fields": fields,
                    }
                },
                status=400,
            )
    if next_due_date and next_issue_date and next_due_date < next_issue_date:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "due_date cannot be before issue_date.",
                    "fields": {"due_date": ["Due date must be on or after issue date."]},
                }
            },
            status=400,
        )

    # Line item validation
    line_items = data.get("line_items")
    has_line_items = line_items is not None
    if has_line_items and not line_items:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one line item is required.",
                    "fields": {"line_items": ["At least one line item is required."]},
                }
            },
            status=400,
        )

    # Field updates (dates and other fields that may accompany the transition)
    update_fields = ["updated_at"]
    if "vendor" in data:
        vendor_bill.vendor_id = data["vendor"]
        update_fields.append("vendor")
    if "bill_number" in data:
        vendor_bill.bill_number = data["bill_number"]
        update_fields.append("bill_number")
    if "received_date" in data:
        vendor_bill.received_date = data["received_date"]
        update_fields.append("received_date")
    if "issue_date" in data:
        vendor_bill.issue_date = data["issue_date"]
        update_fields.append("issue_date")
    if "due_date" in data:
        vendor_bill.due_date = data["due_date"]
        update_fields.append("due_date")
    if "notes" in data:
        vendor_bill.notes = data["notes"]
        update_fields.append("notes")
    vendor_bill.status = next_status
    update_fields.append("status")

    with transaction.atomic():
        vendor_bill.save(update_fields=update_fields)

        if has_line_items:
            next_tax = quantize_money(data.get("tax_amount", vendor_bill.tax_amount))
            next_shipping = quantize_money(data.get("shipping_amount", vendor_bill.shipping_amount))
            apply_error = _apply_vendor_bill_lines_and_totals(
                vendor_bill, line_items, next_tax, next_shipping, request.user,
            )
            if apply_error:
                transaction.set_rollback(True)
                payload, status_code = _vendor_bill_line_apply_error_response(apply_error)
                return Response(payload, status=status_code)
        elif "tax_amount" in data or "shipping_amount" in data:
            existing_lines = [
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit_price": line.unit_price,
                }
                for line in vendor_bill.line_items.all()
            ]
            if existing_lines:
                next_tax = quantize_money(data.get("tax_amount", vendor_bill.tax_amount))
                next_shipping = quantize_money(data.get("shipping_amount", vendor_bill.shipping_amount))
                _apply_vendor_bill_lines_and_totals(
                    vendor_bill, existing_lines, next_tax, next_shipping, request.user,
                )

        if next_status in SNAPSHOT_CAPTURE_STATUSES:
            status_note = (data.get("status_note", "") or "").strip()
            VendorBillSnapshot.record(
                vendor_bill=vendor_bill,
                capture_status=next_status,
                previous_status=previous_status,
                acted_by=request.user,
                status_note=status_note,
            )

    vendor_bill = _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
    return Response(
        {"data": VendorBillSerializer(vendor_bill).data, "meta": {"duplicate_override_used": False}}
    )


def _handle_vb_status_note(request, vendor_bill, data):
    """Append a status note snapshot without changing vendor bill status.

    Called when the PATCH includes a status_note but no actual status change.
    Records a snapshot with capture_status matching the current status.
    """
    note_text = (data.get("status_note", "") or "").strip()

    with transaction.atomic():
        VendorBillSnapshot.record(
            vendor_bill=vendor_bill,
            capture_status=vendor_bill.status,
            previous_status=vendor_bill.status,
            acted_by=request.user,
            status_note=note_text,
        )

    vendor_bill = _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
    return Response(
        {"data": VendorBillSerializer(vendor_bill).data, "meta": {"duplicate_override_used": False}}
    )
