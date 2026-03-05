"""Domain-specific helpers for payment and allocation views."""

from decimal import Decimal

from django.db.models import Sum

from core.models import Invoice, Payment, PaymentAllocation, VendorBill
from core.utils.money import MONEY_ZERO, quantize_money


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
