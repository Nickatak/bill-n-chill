"""Cash-management payment and allocation endpoints."""

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    FinancialAuditEvent,
    Invoice,
    Payment,
    PaymentAllocation,
    PaymentAllocationRecord,
    PaymentRecord,
    VendorBill,
)
from core.serializers import (
    PaymentAllocateSerializer,
    PaymentAllocationSerializer,
    PaymentSerializer,
    PaymentWriteSerializer,
)
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    _record_financial_audit_event,
    _role_gate_error_payload,
    _validate_project_for_user,
)


def _settled_allocated_total(payment: Payment) -> Decimal:
    return quantize_money(
        PaymentAllocation.objects.filter(
            payment=payment,
            payment__status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("applied_amount")).get("total")
        or MONEY_ZERO
    )


def _all_allocated_total(payment: Payment) -> Decimal:
    return quantize_money(
        PaymentAllocation.objects.filter(payment=payment).aggregate(total=Sum("applied_amount")).get("total")
        or MONEY_ZERO
    )


def _set_invoice_balance_from_allocations(invoice: Invoice):
    applied_total = (
        PaymentAllocation.objects.filter(
            invoice=invoice,
            payment__status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("applied_amount")).get("total")
        or Decimal("0")
    )

    next_balance = quantize_money(Decimal(str(invoice.total)) - applied_total)
    if next_balance < MONEY_ZERO:
        next_balance = MONEY_ZERO

    update_fields = ["balance_due", "updated_at"]
    invoice.balance_due = next_balance

    if invoice.status != Invoice.Status.VOID:
        if next_balance == MONEY_ZERO:
            invoice.status = Invoice.Status.PAID
            update_fields.append("status")
        elif next_balance < Decimal(str(invoice.total)):
            invoice.status = Invoice.Status.PARTIALLY_PAID
            update_fields.append("status")
        elif invoice.status in {Invoice.Status.PAID, Invoice.Status.PARTIALLY_PAID}:
            invoice.status = Invoice.Status.SENT
            update_fields.append("status")

    invoice.save(update_fields=list(dict.fromkeys(update_fields)))


def _set_vendor_bill_balance_from_allocations(vendor_bill: VendorBill):
    applied_total = (
        PaymentAllocation.objects.filter(
            vendor_bill=vendor_bill,
            payment__status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("applied_amount")).get("total")
        or Decimal("0")
    )

    next_balance = quantize_money(Decimal(str(vendor_bill.total)) - applied_total)
    if next_balance < MONEY_ZERO:
        next_balance = MONEY_ZERO

    update_fields = ["balance_due", "updated_at"]
    vendor_bill.balance_due = next_balance

    if vendor_bill.status != VendorBill.Status.VOID:
        if next_balance == MONEY_ZERO:
            vendor_bill.status = VendorBill.Status.PAID
            update_fields.append("status")
        elif vendor_bill.status == VendorBill.Status.PAID:
            vendor_bill.status = VendorBill.Status.SCHEDULED
            update_fields.append("status")

    vendor_bill.save(update_fields=list(dict.fromkeys(update_fields)))


def _recalculate_payment_allocation_targets(payment: Payment):
    invoice_ids = set(
        PaymentAllocation.objects.filter(payment=payment, invoice_id__isnull=False).values_list(
            "invoice_id", flat=True
        )
    )
    vendor_bill_ids = set(
        PaymentAllocation.objects.filter(payment=payment, vendor_bill_id__isnull=False).values_list(
            "vendor_bill_id", flat=True
        )
    )

    for invoice in Invoice.objects.filter(id__in=invoice_ids):
        _set_invoice_balance_from_allocations(invoice)

    for vendor_bill in VendorBill.objects.filter(id__in=vendor_bill_ids):
        _set_vendor_bill_balance_from_allocations(vendor_bill)


def _direction_target_mismatch(direction: str, target_type: str) -> bool:
    return (direction == Payment.Direction.INBOUND and target_type != PaymentAllocation.TargetType.INVOICE) or (
        direction == Payment.Direction.OUTBOUND
        and target_type != PaymentAllocation.TargetType.VENDOR_BILL
    )


def _build_payment_snapshot(payment: Payment) -> dict:
    return {
        "payment": {
            "id": payment.id,
            "project_id": payment.project_id,
            "direction": payment.direction,
            "method": payment.method,
            "status": payment.status,
            "amount": str(payment.amount),
            "payment_date": payment.payment_date.isoformat() if payment.payment_date else None,
            "reference_number": payment.reference_number,
            "notes": payment.notes,
            "allocated_total": str(payment.allocated_total),
            "unapplied_amount": str(payment.unapplied_amount),
        }
    }


def _record_payment_record(
    *,
    payment: Payment,
    event_type: str,
    capture_source: str,
    recorded_by,
    from_status: str | None = None,
    to_status: str | None = None,
    source_reference: str = "",
    note: str = "",
    metadata: dict | None = None,
):
    PaymentRecord.objects.create(
        payment=payment,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        from_status=from_status,
        to_status=to_status,
        note=note,
        snapshot_json=_build_payment_snapshot(payment),
        metadata_json=metadata or {},
        recorded_by=recorded_by,
    )


def _build_payment_allocation_snapshot(*, payment: Payment, allocation: PaymentAllocation) -> dict:
    return {
        "payment": _build_payment_snapshot(payment)["payment"],
        "allocation": {
            "id": allocation.id,
            "target_type": allocation.target_type,
            "invoice_id": allocation.invoice_id,
            "vendor_bill_id": allocation.vendor_bill_id,
            "applied_amount": str(allocation.applied_amount),
            "created_by_id": allocation.created_by_id,
            "created_at": allocation.created_at.isoformat() if allocation.created_at else None,
        },
    }


def _record_payment_allocation_record(
    *,
    payment: Payment,
    allocation: PaymentAllocation,
    event_type: str,
    capture_source: str,
    target_type: str,
    target_object_id: int,
    recorded_by,
    source_reference: str = "",
    note: str = "",
    metadata: dict | None = None,
):
    PaymentAllocationRecord.objects.create(
        payment=payment,
        payment_allocation=allocation,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        target_type=target_type,
        target_object_id=target_object_id,
        applied_amount=allocation.applied_amount,
        note=note,
        snapshot_json=_build_payment_allocation_snapshot(payment=payment, allocation=allocation),
        metadata_json=metadata or {},
        recorded_by=recorded_by,
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_payments_view(request, project_id: int):
    """Project payment collection endpoint: `GET` lists payments, `POST` creates a payment.

    Contract:
    - `GET` (user/project-scoped list):
      - `200`: payment list returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `POST` (requires role `owner|bookkeeping`):
      - `201`: payment created and returned.
        - Guarantees:
          - newly created payment includes valid direction/method/amount fields. `[APP]`
          - immutable `PaymentRecord(created)` and `FinancialAuditEvent(payment_updated)` are appended. `[APP]`
      - `400`: payload/business validation failed.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for create.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - project must resolve through user scope (`_validate_project_for_user`).
      - caller role must be `owner|bookkeeping` for `POST`.

    - Object mutations:
      - `GET`: none.
      - `POST`:
        - Creates:
          - Standard: `Payment`.
          - Audit: `PaymentRecord`, `FinancialAuditEvent`.
        - Edits: none.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "_comment_required": "direction, method, and amount are required",
          "direction": "inbound|outbound (required)",
          "method": "cash|check|ach|wire|credit_card|other (required)",
          "amount": "decimal (required)",
          "status": "pending|settled|failed|void (optional, default=pending)",
          "payment_date": "YYYY-MM-DD (optional, default=today)",
          "reference_number": "string (optional)",
          "notes": "string (optional)"
        }

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.
      - `POST` is not idempotent.

    - Test anchors:
      - `backend/core/tests/test_payments.py::test_payment_create_and_project_list`
      - `backend/core/tests/test_payments.py::test_payment_validates_required_fields_and_positive_amount`
      - `backend/core/tests/test_payments.py::test_payment_create_rolls_back_when_audit_write_fails`
    """
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            Payment.objects.filter(project=project, created_by=request.user)
            .select_related("project")
            .prefetch_related("allocations")
            .order_by("-payment_date", "-created_at")
        )
        return Response({"data": PaymentSerializer(rows, many=True).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = PaymentWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    fields = {}
    if "direction" not in data:
        fields["direction"] = ["This field is required."]
    if "method" not in data:
        fields["method"] = ["This field is required."]
    if "amount" not in data:
        fields["amount"] = ["This field is required."]
    if fields:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required fields for payment creation.",
                    "fields": fields,
                }
            },
            status=400,
        )

    with transaction.atomic():
        payment = Payment.objects.create(
            project=project,
            direction=data["direction"],
            method=data["method"],
            status=data.get("status", Payment.Status.PENDING),
            amount=data["amount"],
            payment_date=data.get("payment_date") or timezone.localdate(),
            reference_number=data.get("reference_number", ""),
            notes=data.get("notes", ""),
            created_by=request.user,
        )
        _record_payment_record(
            payment=payment,
            event_type=PaymentRecord.EventType.CREATED,
            capture_source=PaymentRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=None,
            to_status=payment.status,
            note="Payment created.",
            metadata={"direction": payment.direction, "method": payment.method},
        )
        _record_financial_audit_event(
            project=project,
            event_type=FinancialAuditEvent.EventType.PAYMENT_UPDATED,
            object_type="payment",
            object_id=payment.id,
            from_status="",
            to_status=payment.status,
            amount=payment.amount,
            note="Payment created.",
            created_by=request.user,
            metadata={"direction": payment.direction, "method": payment.method},
        )
    return Response({"data": PaymentSerializer(payment).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def payment_detail_view(request, payment_id: int):
    """Fetch or update a payment while enforcing transition and allocation safety rules.

    Contract:
    - `GET`:
      - `200`: payment detail returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: payment not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `PATCH` (requires role `owner|bookkeeping`):
      - `200`: patch applied and updated payment returned.
        - Guarantees:
          - payment transition/allocation safety rules remain satisfied. `[APP]`
          - immutable payment record and financial audit row are appended when fields changed. `[APP]`
      - `400`: validation or transition/allocation safety failure.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for patch.
        - Guarantees: no object mutations. `[APP]`
      - `404`: payment not found for this user.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - payment must belong to requesting user.
      - caller role must be `owner|bookkeeping`.

    - Object mutations:
      - `GET`: none.
      - `PATCH`:
        - Creates:
          - Standard: none.
          - Audit: `PaymentRecord`, `FinancialAuditEvent` when updates occur.
        - Edits:
          - Standard: `Payment` fields (direction/method/status/amount/date/reference/notes).
          - Audit: none.
        - Deletes: none.

    - Incoming payload (`PATCH`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "direction": "inbound|outbound (optional; blocked after allocations exist)",
          "method": "cash|check|ach|wire|credit_card|other (optional)",
          "status": "pending|settled|failed|void (optional; transition rules apply)",
          "amount": "decimal (optional; cannot be below allocated total)",
          "payment_date": "YYYY-MM-DD (optional)",
          "reference_number": "string (optional)",
          "notes": "string (optional)"
        }

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.
      - `PATCH` is conditionally idempotent when payload values equal persisted values.

    - Test anchors:
      - `backend/core/tests/test_payments.py::test_payment_status_transition_validation`
      - `backend/core/tests/test_payments.py::test_payment_patch_updates_direction_method_status_reference`
      - `backend/core/tests/test_payments.py::test_payment_records_append_for_status_change_and_allocation`
    """
    try:
        payment = Payment.objects.select_related("project").prefetch_related("allocations").get(
            id=payment_id,
            created_by=request.user,
        )
    except Payment.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Payment not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": PaymentSerializer(payment).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = PaymentWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    has_allocations = payment.allocations.exists()
    previous_status = payment.status

    if "status" in data and not Payment.is_transition_allowed(
        current_status=payment.status,
        next_status=data["status"],
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid payment status transition: {payment.status} -> {data['status']}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    if "direction" in data and data["direction"] != payment.direction and has_allocations:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Cannot change payment direction after allocations exist.",
                    "fields": {"direction": ["Remove allocations before changing direction."]},
                }
            },
            status=400,
        )

    if "amount" in data:
        allocated_total = _all_allocated_total(payment)
        if Decimal(str(data["amount"])) < allocated_total:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Payment amount cannot be lower than allocated total.",
                        "fields": {
                            "amount": [
                                f"Current allocated total is {allocated_total}. Increase amount or adjust allocations."
                            ]
                        },
                    }
                },
                status=400,
            )

    update_fields = ["updated_at"]
    for field in [
        "direction",
        "method",
        "status",
        "amount",
        "payment_date",
        "reference_number",
        "notes",
    ]:
        if field in data:
            setattr(payment, field, data[field])
            update_fields.append(field)

    with transaction.atomic():
        if len(update_fields) > 1:
            payment.save(update_fields=update_fields)

        status_changed = payment.status != previous_status
        if status_changed and {
            previous_status,
            payment.status,
        } & {Payment.Status.SETTLED}:
            _recalculate_payment_allocation_targets(payment)
        if len(update_fields) > 1:
            _record_payment_record(
                payment=payment,
                event_type=(
                    PaymentRecord.EventType.STATUS_CHANGED
                    if status_changed
                    else PaymentRecord.EventType.UPDATED
                ),
                capture_source=PaymentRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                from_status=previous_status,
                to_status=payment.status,
                note="Payment updated.",
                metadata={
                    "direction": payment.direction,
                    "method": payment.method,
                    "status_changed": status_changed,
                },
            )
            _record_financial_audit_event(
                project=payment.project,
                event_type=FinancialAuditEvent.EventType.PAYMENT_UPDATED,
                object_type="payment",
                object_id=payment.id,
                from_status=previous_status,
                to_status=payment.status,
                amount=payment.amount,
                note="Payment updated.",
                created_by=request.user,
                metadata={
                    "direction": payment.direction,
                    "method": payment.method,
                    "status_changed": status_changed,
                },
            )

    payment.refresh_from_db()
    return Response({"data": PaymentSerializer(payment).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def payment_allocate_view(request, payment_id: int):
    """Allocate a settled payment to invoices or vendor bills based on payment direction.

    Contract:
    - `POST` (requires role `owner|bookkeeping`):
      - `200`: allocations applied and updated payment returned.
        - Guarantees:
          - all allocation rows satisfy direction/target/scope eligibility rules. `[APP]`
          - target balances/statuses and payment allocation totals are recalculated consistently. `[APP]`
          - immutable allocation records and financial audit row are appended. `[APP]`
      - `400`: validation/allocation eligibility failure.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for allocation.
        - Guarantees: no object mutations. `[APP]`
      - `404`: payment not found for this user.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - payment must belong to requesting user.
      - payment status must be `settled`.
      - inbound allocations target invoices; outbound allocations target vendor bills.

    - Object mutations:
      - `POST`:
        - Creates:
          - Standard: `PaymentAllocation` rows.
          - Audit: `PaymentRecord`, `PaymentAllocationRecord`, `FinancialAuditEvent`.
        - Edits:
          - Standard: payment allocation totals plus target invoice/vendor-bill balances and statuses.
          - Audit: none.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "_comment_required": "allocations must include at least 1 row",
          "allocations": [
            {
              "target_type": "invoice|vendor_bill (required; must match payment direction)",
              "target_id": "integer (required)",
              "applied_amount": "decimal (required, must be > 0)",
              "note": "string (optional)"
            }
          ]
        }

    - Idempotency and retry semantics:
      - `POST` is not idempotent; repeating same payload will stack additional allocations unless rejected by remaining-balance rules.
      - failed allocation retries do not persist partial writes.

    - Test anchors:
      - `backend/core/tests/test_payments.py::test_payment_allocation_inbound_partial_updates_invoice_balances`
      - `backend/core/tests/test_payments.py::test_payment_allocation_outbound_partial_updates_vendor_bill_balances`
      - `backend/core/tests/test_payments.py::test_payment_allocation_blocks_direction_mismatch_and_overallocation`
    """
    try:
        payment = Payment.objects.select_related("project").prefetch_related("allocations").get(
            id=payment_id,
            created_by=request.user,
        )
    except Payment.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Payment not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    if payment.status != Payment.Status.SETTLED:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Only settled payments can be allocated.",
                    "fields": {"status": ["Set payment status to settled before allocation."]},
                }
            },
            status=400,
        )

    serializer = PaymentAllocateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data
    allocations_data = payload.get("allocations", [])

    if not allocations_data:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one allocation row is required.",
                    "fields": {"allocations": ["Provide at least one allocation."]},
                }
            },
            status=400,
        )

    fields = {}
    new_total = MONEY_ZERO
    resolved_targets = []

    for index, row in enumerate(allocations_data):
        target_type = row["target_type"]
        target_id = row["target_id"]

        if _direction_target_mismatch(payment.direction, target_type):
            fields[f"allocations[{index}].target_type"] = [
                "target_type does not match payment direction."
            ]
            continue

        if target_type == PaymentAllocation.TargetType.INVOICE:
            target = Invoice.objects.filter(
                id=target_id,
                created_by=request.user,
                project=payment.project,
            ).first()
            if not target:
                fields[f"allocations[{index}].target_id"] = [
                    "Invoice not found for this user/project."
                ]
                continue
            if target.status == Invoice.Status.VOID:
                fields[f"allocations[{index}].target_id"] = [
                    "Cannot allocate against a void invoice."
                ]
                continue
            if target.balance_due <= Decimal("0"):
                fields[f"allocations[{index}].target_id"] = [
                    "Invoice has no remaining balance due."
                ]
                continue
            resolved_targets.append((row, target, None))
        else:
            target = VendorBill.objects.filter(
                id=target_id,
                created_by=request.user,
                project=payment.project,
            ).first()
            if not target:
                fields[f"allocations[{index}].target_id"] = [
                    "Vendor bill not found for this user/project."
                ]
                continue
            if target.status == VendorBill.Status.VOID:
                fields[f"allocations[{index}].target_id"] = [
                    "Cannot allocate against a void vendor bill."
                ]
                continue
            if target.balance_due <= Decimal("0"):
                fields[f"allocations[{index}].target_id"] = [
                    "Vendor bill has no remaining balance due."
                ]
                continue
            resolved_targets.append((row, None, target))

        new_total = quantize_money(new_total + Decimal(str(row["applied_amount"])))

    if fields:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more allocations are invalid.",
                    "fields": fields,
                }
            },
            status=400,
        )

    existing_total = _all_allocated_total(payment)
    max_allocatable = quantize_money(Decimal(str(payment.amount)) - existing_total)
    if new_total > max_allocatable:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Allocation amount exceeds unapplied payment balance.",
                    "fields": {
                        "allocations": [
                            f"Requested {new_total}, but only {max_allocatable} remains unapplied."
                        ]
                    },
                }
            },
            status=400,
        )

    with transaction.atomic():
        created_allocations = []
        for row, invoice, vendor_bill in resolved_targets:
            created_allocations.append(
                (
                    PaymentAllocation.objects.create(
                    payment=payment,
                    target_type=row["target_type"],
                    invoice=invoice,
                    vendor_bill=vendor_bill,
                    applied_amount=row["applied_amount"],
                    created_by=request.user,
                    ),
                    row,
                    invoice,
                    vendor_bill,
                )
            )

        touched_invoice_ids = [invoice.id for _, invoice, _ in resolved_targets if invoice]
        touched_vendor_bill_ids = [vendor_bill.id for _, _, vendor_bill in resolved_targets if vendor_bill]

        for invoice in Invoice.objects.filter(id__in=touched_invoice_ids):
            _set_invoice_balance_from_allocations(invoice)

        for vendor_bill in VendorBill.objects.filter(id__in=touched_vendor_bill_ids):
            _set_vendor_bill_balance_from_allocations(vendor_bill)

        for allocation, row, invoice, vendor_bill in created_allocations:
            target_id = invoice.id if invoice else vendor_bill.id
            target_type = "invoice" if invoice else "vendor_bill"
            _record_financial_audit_event(
                project=payment.project,
                event_type=FinancialAuditEvent.EventType.PAYMENT_ALLOCATED,
                object_type="payment_allocation",
                object_id=payment.id,
                from_status=payment.status,
                to_status=payment.status,
                amount=row["applied_amount"],
                note=f"Payment allocated to {target_type} #{target_id}.",
                created_by=request.user,
                metadata={
                    "payment_id": payment.id,
                    "payment_allocation_id": allocation.id,
                    "target_type": target_type,
                    "target_id": target_id,
                },
            )
            _record_payment_allocation_record(
                payment=payment,
                allocation=allocation,
                event_type=PaymentAllocationRecord.EventType.APPLIED,
                capture_source=PaymentAllocationRecord.CaptureSource.MANUAL_UI,
                target_type=target_type,
                target_object_id=target_id,
                recorded_by=request.user,
                note=f"Allocation applied to {target_type} #{target_id}.",
                metadata={
                    "payment_id": payment.id,
                    "payment_allocation_id": allocation.id,
                    "target_type": target_type,
                    "target_id": target_id,
                },
            )
        _record_payment_record(
            payment=payment,
            event_type=PaymentRecord.EventType.ALLOCATION_APPLIED,
            capture_source=PaymentRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=payment.status,
            to_status=payment.status,
            note=f"Applied {len(resolved_targets)} allocation row(s).",
            metadata={
                "allocation_count": len(resolved_targets),
                "allocations": [
                    {
                        "target_type": "invoice" if invoice else "vendor_bill",
                        "target_id": invoice.id if invoice else vendor_bill.id,
                        "applied_amount": str(row["applied_amount"]),
                        "payment_allocation_id": allocation.id,
                    }
                    for allocation, row, invoice, vendor_bill in created_allocations
                ],
            },
        )

    payment.refresh_from_db()
    payment = Payment.objects.select_related("project").prefetch_related("allocations").get(id=payment.id)
    created_rows = [allocation for allocation, _, _, _ in created_allocations]

    return Response(
        {
            "data": {
                "payment": PaymentSerializer(payment).data,
                "created_allocations": PaymentAllocationSerializer(created_rows, many=True).data,
            },
            "meta": {
                "allocated_total": f"{payment.allocated_total:.2f}",
                "unapplied_amount": f"{payment.unapplied_amount:.2f}",
            },
        },
        status=201,
    )
