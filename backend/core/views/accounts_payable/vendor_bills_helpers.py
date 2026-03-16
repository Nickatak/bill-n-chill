"""Domain-specific helpers for vendor bill views."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.response import Response

from core.models import CostCode, Vendor, VendorBill, VendorBillLine, VendorBillSnapshot
from core.serializers import VendorBillSerializer
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


def _prefetch_vendor_bill_qs(qs):
    """Apply standard select/prefetch for vendor bill queries."""
    return qs.select_related("project", "vendor", "cost_code").prefetch_related(
        "line_items", "line_items__cost_code"
    )


RECEIVED_PLUS_STATUSES = {
    VendorBill.Status.RECEIVED,
    VendorBill.Status.APPROVED,
    VendorBill.Status.SCHEDULED,
    VendorBill.Status.PAID,
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
    next_scheduled_for = data.get("scheduled_for", vendor_bill.scheduled_for)
    if next_status in RECEIVED_PLUS_STATUSES:
        fields = {}
        if next_issue_date is None:
            fields["issue_date"] = ["Issue/received date is required for received-or-later bills."]
        if next_due_date is None:
            fields["due_date"] = ["Due date is required for received-or-later bills."]
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
    if next_due_date < next_issue_date:
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
    if next_status == VendorBill.Status.SCHEDULED and not next_scheduled_for:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "scheduled_for is required when status is scheduled.",
                    "fields": {"scheduled_for": ["Provide a scheduled payment date."]},
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
    if "scheduled_for" in data:
        vendor_bill.scheduled_for = data["scheduled_for"]
        update_fields.append("scheduled_for")
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
                    "unit": line.unit,
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

        # Recompute balance_due based on status
        vendor_bill.refresh_from_db()
        candidate_balance_due = (
            MONEY_ZERO if next_status == VendorBill.Status.PAID else vendor_bill.total
        )
        if candidate_balance_due != vendor_bill.balance_due:
            vendor_bill.balance_due = candidate_balance_due
            vendor_bill.save(update_fields=["balance_due", "updated_at"])

    vendor_bill = _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
    return Response(
        {"data": VendorBillSerializer(vendor_bill).data, "meta": {"duplicate_override_used": False}}
    )


def _handle_vb_status_transition(
    request, vendor_bill, data, previous_status, next_status,
):
    """Handle a vendor bill status transition: validate, apply, snapshot, balance.

    Called when the PATCH includes a real status change (previous != next).
    Handles the compound received -> scheduled shortcut (walks through approved
    intermediate), snapshot recording, and balance_due recomputation.
    """
    compound_received_to_scheduled = (
        previous_status == VendorBill.Status.RECEIVED
        and next_status == VendorBill.Status.SCHEDULED
    )

    if not compound_received_to_scheduled and not VendorBill.is_transition_allowed(
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
    next_scheduled_for = data.get("scheduled_for", vendor_bill.scheduled_for)
    if next_status in RECEIVED_PLUS_STATUSES:
        fields = {}
        if next_issue_date is None:
            fields["issue_date"] = ["Issue/received date is required for received-or-later bills."]
        if next_due_date is None:
            fields["due_date"] = ["Due date is required for received-or-later bills."]
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
    if next_due_date < next_issue_date:
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
    if next_status == VendorBill.Status.SCHEDULED and not next_scheduled_for:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "scheduled_for is required when status is scheduled.",
                    "fields": {"scheduled_for": ["Provide a scheduled payment date."]},
                }
            },
            status=400,
        )

    # Mark-paid note validation — required when provided (manual mark-paid path)
    mark_paid_note = data.get("mark_paid_note", "").strip() if next_status == VendorBill.Status.PAID else ""

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
    if "scheduled_for" in data:
        vendor_bill.scheduled_for = data["scheduled_for"]
        update_fields.append("scheduled_for")
    if "notes" in data:
        vendor_bill.notes = data["notes"]
        update_fields.append("notes")
    vendor_bill.status = next_status
    update_fields.append("status")

    with transaction.atomic():
        if compound_received_to_scheduled:
            # Step 1: received -> approved (intermediate)
            vendor_bill.status = VendorBill.Status.APPROVED
            intermediate_update_fields = [f for f in update_fields if f != "status"] + ["status"]
            vendor_bill.save(update_fields=intermediate_update_fields)
            VendorBillSnapshot.record(
                vendor_bill=vendor_bill,
                capture_status=VendorBill.Status.APPROVED,
                previous_status=previous_status,
                acted_by=request.user,
            )
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

            # Step 2: approved -> scheduled (final)
            vendor_bill.status = VendorBill.Status.SCHEDULED
            vendor_bill.save(update_fields=["status", "updated_at"])
            VendorBillSnapshot.record(
                vendor_bill=vendor_bill,
                capture_status=VendorBill.Status.SCHEDULED,
                previous_status=VendorBill.Status.APPROVED,
                acted_by=request.user,
            )
        else:
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
                        "unit": line.unit,
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

            # Recompute balance_due based on status
            vendor_bill.refresh_from_db()
            candidate_balance_due = (
                MONEY_ZERO if next_status == VendorBill.Status.PAID else vendor_bill.total
            )
            if candidate_balance_due != vendor_bill.balance_due:
                vendor_bill.balance_due = candidate_balance_due
                vendor_bill.save(update_fields=["balance_due", "updated_at"])

            if (
                previous_status != next_status
                and next_status in {
                    VendorBill.Status.RECEIVED,
                    VendorBill.Status.APPROVED,
                    VendorBill.Status.SCHEDULED,
                    VendorBill.Status.PAID,
                    VendorBill.Status.VOID,
                }
            ):
                VendorBillSnapshot.record(
                    vendor_bill=vendor_bill,
                    capture_status=next_status,
                    previous_status=previous_status,
                    acted_by=request.user,
                    mark_paid_note=mark_paid_note,
                )

    vendor_bill = _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
    return Response(
        {"data": VendorBillSerializer(vendor_bill).data, "meta": {"duplicate_override_used": False}}
    )


# ---------------------------------------------------------------------------
# Receipt creation
# ---------------------------------------------------------------------------


def _create_receipt(request, project, data):
    """Create a lightweight receipt (terminal ``recorded`` status, no line items required).

    Required fields: ``total``.
    Optional: ``vendor``, ``cost_code``, ``notes``, ``received_date``.
    """
    total_raw = data.get("total")
    if total_raw is None:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Total is required for receipts.",
                    "fields": {"total": ["This field is required."]},
                }
            },
            status=400,
        )

    total = quantize_money(total_raw)
    if total <= MONEY_ZERO:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Total must be greater than zero.",
                    "fields": {"total": ["Must be greater than zero."]},
                }
            },
            status=400,
        )

    # Optional vendor
    vendor = None
    vendor_id = data.get("vendor")
    if vendor_id is not None:
        vendor = Vendor.objects.filter(_vendor_scope_filter(request.user), id=vendor_id).first()
        if not vendor:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Vendor is invalid for this user.",
                        "fields": {"vendor": ["Select a valid vendor."]},
                    }
                },
                status=400,
            )

    # Optional cost code
    cost_code = None
    cost_code_id = data.get("cost_code")
    if cost_code_id is not None:
        from core.user_helpers import _ensure_membership

        membership = _ensure_membership(request.user)
        cost_code = CostCode.objects.filter(
            organization_id=membership.organization_id,
            id=cost_code_id,
            is_active=True,
        ).first()
        if not cost_code:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Cost code is invalid.",
                        "fields": {"cost_code": ["Select a valid cost code."]},
                    }
                },
                status=400,
            )

    received_date = data.get("received_date") or timezone.localdate()

    with transaction.atomic():
        receipt = VendorBill.objects.create(
            kind=VendorBill.Kind.RECEIPT,
            project=project,
            vendor=vendor,
            cost_code=cost_code,
            bill_number="",
            status=VendorBill.Status.RECORDED,
            received_date=received_date,
            total=total,
            balance_due=MONEY_ZERO,
            notes=data.get("notes", ""),
            created_by=request.user,
        )

    return Response(
        {
            "data": VendorBillSerializer(
                _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=receipt.id)).get()
            ).data,
        },
        status=201,
    )
