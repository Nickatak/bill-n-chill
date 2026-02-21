from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import FinancialAuditEvent, Invoice, Payment, PaymentAllocation, VendorBill
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
    _validate_payment_status_transition,
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


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_payments_view(request, project_id: int):
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

    if "status" in data and not _validate_payment_status_transition(
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
        creates = []
        for row, invoice, vendor_bill in resolved_targets:
            creates.append(
                PaymentAllocation(
                    payment=payment,
                    target_type=row["target_type"],
                    invoice=invoice,
                    vendor_bill=vendor_bill,
                    applied_amount=row["applied_amount"],
                    created_by=request.user,
                )
            )
        PaymentAllocation.objects.bulk_create(creates)

        touched_invoice_ids = [invoice.id for _, invoice, _ in resolved_targets if invoice]
        touched_vendor_bill_ids = [vendor_bill.id for _, _, vendor_bill in resolved_targets if vendor_bill]

        for invoice in Invoice.objects.filter(id__in=touched_invoice_ids):
            _set_invoice_balance_from_allocations(invoice)

        for vendor_bill in VendorBill.objects.filter(id__in=touched_vendor_bill_ids):
            _set_vendor_bill_balance_from_allocations(vendor_bill)

        for row, invoice, vendor_bill in resolved_targets:
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
                    "target_type": target_type,
                    "target_id": target_id,
                },
            )

    payment.refresh_from_db()
    payment = Payment.objects.select_related("project").prefetch_related("allocations").get(id=payment.id)
    created_rows = PaymentAllocation.objects.filter(payment=payment).order_by("-created_at", "-id")[: len(creates)]

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
