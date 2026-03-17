"""Domain-specific helpers for payment and allocation views."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Sum

from core.models import Invoice, Payment, PaymentAllocation, VendorBill
from core.models.financial_auditing.invoice_status_event import InvoiceStatusEvent
from core.utils.money import MONEY_ZERO, quantize_money

User = get_user_model()


def _settled_allocated_total(payment: Payment) -> Decimal:
    """Return the total amount allocated from a payment's settled allocations only."""
    return quantize_money(
        PaymentAllocation.objects.filter(
            payment=payment,
            payment__status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("applied_amount")).get("total")
        or MONEY_ZERO
    )


def _all_allocated_total(payment: Payment) -> Decimal:
    """Return the total amount allocated from a payment across all statuses."""
    return quantize_money(
        PaymentAllocation.objects.filter(payment=payment).aggregate(total=Sum("applied_amount")).get("total")
        or MONEY_ZERO
    )


def _set_invoice_balance_from_allocations(invoice: Invoice, *, changed_by: "User"):
    """Recompute an invoice's balance_due and status from its settled payment allocations."""
    previous_status = invoice.status
    previous_balance = invoice.balance_due

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

    # System-driven status reversals (e.g. paid → sent after payment void)
    # bypass the model's transition validation since these are not user-initiated.
    invoice._skip_transition_validation = True
    try:
        invoice.save(update_fields=list(dict.fromkeys(update_fields)))
    finally:
        invoice._skip_transition_validation = False

    # Record audit event when the status actually changed.
    if invoice.status != previous_status:
        balance_restored = next_balance - previous_balance
        if balance_restored > MONEY_ZERO:
            note = f"Payment voided — ${balance_restored:,.2f} balance restored."
        elif invoice.status == Invoice.Status.PAID:
            note = "Payment settled — invoice fully paid."
        else:
            note = "Payment applied — invoice partially paid."

        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=previous_status,
            to_status=invoice.status,
            note=note,
            changed_by=changed_by,
        )


def _set_vendor_bill_balance_from_allocations(vendor_bill: VendorBill):
    """Recompute a vendor bill's balance_due from its settled payment allocations.

    Bill document status is NOT changed — payment status (unpaid/partial/paid)
    is derived from allocation coverage, not stored as a bill status.
    See ``docs/decisions/ap-model-separation.md``.
    """
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

    vendor_bill.balance_due = next_balance
    # System-driven balance update — bypass transition validation.
    vendor_bill._skip_transition_validation = True
    try:
        vendor_bill.save(update_fields=["balance_due", "updated_at"])
    finally:
        vendor_bill._skip_transition_validation = False


def _recalculate_payment_allocation_targets(payment: Payment, *, changed_by: "User"):
    """Refresh balance_due on all invoices and vendor bills linked to a payment."""
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
        _set_invoice_balance_from_allocations(invoice, changed_by=changed_by)

    for vendor_bill in VendorBill.objects.filter(id__in=vendor_bill_ids):
        _set_vendor_bill_balance_from_allocations(vendor_bill)


def _direction_target_mismatch(direction: str, target_type: str) -> bool:
    """Return True if the allocation target type is incompatible with the payment direction."""
    return (direction == Payment.Direction.INBOUND and target_type != PaymentAllocation.TargetType.INVOICE) or (
        direction == Payment.Direction.OUTBOUND
        and target_type != PaymentAllocation.TargetType.VENDOR_BILL
    )
