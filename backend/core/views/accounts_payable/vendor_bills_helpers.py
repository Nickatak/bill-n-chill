"""Domain-specific helpers for vendor bill views."""

from __future__ import annotations

import datetime
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)

from django.db import transaction
from django.db.models import QuerySet
from rest_framework.request import Request
from rest_framework.response import Response

from core.models import VendorBill, VendorBillLine, VendorBillSnapshot
from core.serializers import VendorBillSerializer
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _resolve_cost_codes_for_user

# Statuses that require issue_date and due_date.
DATE_REQUIRED_STATUSES = {
    VendorBill.Status.OPEN,
}


def _find_duplicate_vendor_bills(
    user,
    *,
    vendor_id: int,
    bill_number: str,
    exclude_vendor_bill_id: int | None = None,
) -> list[VendorBill]:
    """Find existing vendor bills with the same vendor + bill_number (case-insensitive).

    Used for duplicate detection before creating or re-identifying a bill.
    Returns an empty list early if vendor_id or bill_number is missing.
    Pass ``exclude_vendor_bill_id`` to omit the bill being edited from results.
    """
    from core.user_helpers import _ensure_org_membership

    bill_number_norm = (bill_number or "").strip()
    if not vendor_id or not bill_number_norm:
        return []
    membership = _ensure_org_membership(user)

    matching_bills = VendorBill.objects.filter(
        project__organization_id=membership.organization_id,
        vendor_id=vendor_id,
        bill_number__iexact=bill_number_norm,
    )
    if exclude_vendor_bill_id:
        matching_bills = matching_bills.exclude(id=exclude_vendor_bill_id)

    return list(matching_bills.select_related("vendor", "project").order_by("-created_at", "-id"))


def _calculate_vendor_bill_line_totals(line_items_data: list[dict]) -> tuple[list[dict], Decimal]:
    """Compute per-line amounts and return normalized items with a running subtotal.

    Each item gets ``quantity * unit_price`` computed and quantized to 2
    decimal places. Returns ``(normalized_items, subtotal)`` where each
    normalized item has ``quantity``, ``unit_price``, and ``amount`` set.
    """
    subtotal = MONEY_ZERO
    normalized_items = []
    for line_item in line_items_data:
        quantity = Decimal(str(line_item.get("quantity", 1)))
        unit_price = quantize_money(Decimal(str(line_item["unit_price"])))
        amount = quantize_money(quantity * unit_price)
        subtotal = quantize_money(subtotal + amount)
        normalized_items.append({
            **line_item,
            "quantity": quantity,
            "unit_price": unit_price,
            "amount": amount,
        })
    return normalized_items, subtotal


def _apply_vendor_bill_lines_and_totals(
    vendor_bill: VendorBill,
    line_items_data: list[dict],
    tax_amount: Decimal,
    shipping_amount: Decimal,
    user,
) -> dict | None:
    """Replace a vendor bill's line items and recompute all totals.

    Callers must wrap this in ``transaction.atomic()`` — the function
    deletes all existing lines, bulk-creates replacements, and updates
    totals on the bill. A failure between steps without a transaction
    would leave the bill in an inconsistent state.

    Returns an error dict (``{"missing_cost_codes": [...]}`` ) on failure,
    or None on success. Total = subtotal (sum of line amounts) + tax + shipping.
    """
    normalized_items, subtotal = _calculate_vendor_bill_line_totals(line_items_data)
    cost_code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_amount = quantize_money(Decimal(str(tax_amount)))
    shipping_amount = quantize_money(Decimal(str(shipping_amount)))
    total = quantize_money(subtotal + tax_amount + shipping_amount)

    vendor_bill.line_items.all().delete()
    new_lines = []
    for line_item in normalized_items:
        cost_code_id = line_item.get("cost_code")
        cost_code = cost_code_map.get(cost_code_id) if cost_code_id else None
        new_lines.append(
            VendorBillLine(
                vendor_bill=vendor_bill,
                cost_code=cost_code,
                description=line_item.get("description", ""),
                quantity=line_item["quantity"],
                unit_price=line_item["unit_price"],
                amount=line_item["amount"],  # pre-computed; bulk_create bypasses save()
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


def _vendor_bill_line_apply_error_response(apply_error: dict) -> tuple[dict, int]:
    """Convert an ``_apply_vendor_bill_lines_and_totals`` error dict into an HTTP response tuple.

    Returns ``(body, status_code)`` ready for ``Response(body, status=status_code)``.
    Currently handles ``missing_cost_codes``; falls back to a generic
    validation error for any unrecognized error shape.
    """
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


def _prefetch_vendor_bill_qs(queryset: QuerySet) -> QuerySet:
    """Eagerly load vendor bill relations to prevent N+1 query problems.

    Without this, serializing a list of vendor bills would fire separate SQL
    queries for each bill's project, vendor, line items, cost codes, and
    payments — scaling linearly with the number of rows.

    - select_related: JOINs project + vendor in a single query (FK lookups).
    - prefetch_related: batches separate queries for reverse-FK line items,
      their cost codes, and target payments, mapping results back in Python.
    """
    return queryset.select_related("project", "vendor", "store").prefetch_related(
        "line_items", "line_items__cost_code",
        "target_payments",
    )


def _validate_vb_dates(
    next_status: str,
    next_issue_date: datetime.date | None,
    next_due_date: datetime.date | None,
) -> dict | None:
    """Validate date requirements for a vendor bill status.

    Returns an error payload dict if validation fails, or None if valid.
    Checks: (1) required dates present for certain statuses,
    (2) due_date >= issue_date when both are set.
    """
    if next_status in DATE_REQUIRED_STATUSES:
        fields = {}
        if next_issue_date is None:
            fields["issue_date"] = ["Issue date is required."]
        if next_due_date is None:
            fields["due_date"] = ["Due date is required."]
        if fields:
            return {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required date fields for the selected status.",
                    "fields": fields,
                }
            }
    if next_due_date and next_issue_date and next_due_date < next_issue_date:
        return {
            "error": {
                "code": "validation_error",
                "message": "due_date cannot be before issue_date.",
                "fields": {"due_date": ["Due date must be on or after issue date."]},
            }
        }
    return None


def _validate_vb_line_items_present(line_items: list | None) -> dict | None:
    """Validate that line items are non-empty when provided.

    Returns an error payload dict if line_items is an empty list,
    or None if valid (including when line_items is None, meaning
    no line item update was requested).
    """
    if line_items is not None and not line_items:
        return {
            "error": {
                "code": "validation_error",
                "message": "At least one line item is required.",
                "fields": {"line_items": ["At least one line item is required."]},
            }
        }
    return None


# Statuses that trigger snapshot capture on transition.
SNAPSHOT_CAPTURE_STATUSES = {
    VendorBill.Status.OPEN,
    VendorBill.Status.DISPUTED,
    VendorBill.Status.CLOSED,
    VendorBill.Status.VOID,
}


# ---------------------------------------------------------------------------
# PATCH concern handlers — called by the thin dispatcher in vendor_bills.py
# ---------------------------------------------------------------------------


def _handle_vb_document_save(request: Request, vendor_bill: VendorBill, data: dict) -> Response:
    """Apply field updates, line items, and totals to a vendor bill (the 'save' concern).

    Does not perform status transitions or snapshot recording — only
    persists field-level edits and recomputes totals when line items change.

    Flow:
        1. Validate dates (required fields per status, due >= issue).
        2. Validate line items non-empty if provided.
        3. Apply field updates (vendor, dates, notes, status echo).
        4. If line items provided: delete + recreate lines, recompute totals.
        5. Else if only tax/shipping changed: recompute totals with existing lines.
        6. Return serialized bill.
    """
    next_status = data.get("status", vendor_bill.status)

    # Date validation
    next_issue_date = data.get("issue_date", vendor_bill.issue_date)
    next_due_date = data.get("due_date", vendor_bill.due_date)
    if date_error := _validate_vb_dates(next_status, next_issue_date, next_due_date):
        return Response(date_error, status=400)

    # Line item validation
    line_items = data.get("line_items")
    if line_items_error := _validate_vb_line_items_present(line_items):
        return Response(line_items_error, status=400)
    has_line_items = line_items is not None

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
            current_line_dicts = [
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit_price": line.unit_price,
                }
                for line in vendor_bill.line_items.all()
            ]
            if current_line_dicts:
                next_tax = quantize_money(data.get("tax_amount", vendor_bill.tax_amount))
                next_shipping = quantize_money(data.get("shipping_amount", vendor_bill.shipping_amount))
                _apply_vendor_bill_lines_and_totals(
                    vendor_bill, current_line_dicts, next_tax, next_shipping, request.user,
                )

        # balance_due is now purely driven by payment allocations, not status.
        # No balance recomputation on save — that happens in the allocation flow.

    vendor_bill = _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
    return Response(
        {"data": VendorBillSerializer(vendor_bill).data}
    )


def _handle_vb_status_transition(
    request: Request,
    vendor_bill: VendorBill,
    data: dict,
    previous_status: str,
    next_status: str,
) -> Response:
    """Handle a vendor bill status transition: validate, apply, snapshot.

    Called when the PATCH includes a real status change (previous != next).
    Document lifecycle only — no payment/balance logic.

    Flow:
        1. Reject if the transition is not allowed by the state machine.
        2. Validate dates and line items.
        3. Apply field updates + new status.
        4. If line items provided: delete + recreate lines, recompute totals.
        5. Else if only tax/shipping changed: recompute totals with existing lines.
        6. Capture an immutable snapshot if the new status is in ``SNAPSHOT_CAPTURE_STATUSES``.
        7. Return serialized bill.
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
    if date_error := _validate_vb_dates(next_status, next_issue_date, next_due_date):
        return Response(date_error, status=400)

    # Line item validation
    line_items = data.get("line_items")
    if line_items_error := _validate_vb_line_items_present(line_items):
        return Response(line_items_error, status=400)
    has_line_items = line_items is not None

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
            current_line_dicts = [
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit_price": line.unit_price,
                }
                for line in vendor_bill.line_items.all()
            ]
            if current_line_dicts:
                next_tax = quantize_money(data.get("tax_amount", vendor_bill.tax_amount))
                next_shipping = quantize_money(data.get("shipping_amount", vendor_bill.shipping_amount))
                _apply_vendor_bill_lines_and_totals(
                    vendor_bill, current_line_dicts, next_tax, next_shipping, request.user,
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
            logger.info("Vendor bill status transition: id=%s %s (%s → %s) by %s", vendor_bill.id, vendor_bill.bill_number or "(no number)", previous_status, next_status, request.user.email)

    vendor_bill = _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
    return Response(
        {"data": VendorBillSerializer(vendor_bill).data}
    )


def _handle_vb_status_note(request: Request, vendor_bill: VendorBill, data: dict) -> Response:
    """Append a status note snapshot without changing vendor bill status.

    Called when the PATCH includes a ``status_note`` but no actual status
    change. Records a snapshot with ``capture_status`` matching the
    current status — effectively a timestamped note on the bill's timeline.

    Flow:
        1. Extract and trim the status note text.
        2. Record a snapshot with current status as both previous and capture.
        3. Return serialized bill.
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
        {"data": VendorBillSerializer(vendor_bill).data}
    )
