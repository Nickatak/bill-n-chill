"""Domain-specific helpers for payment views."""

from decimal import Decimal
from typing import Any

from django.contrib.auth import get_user_model
from django.db.models import Model, Sum

from core.models import Customer, Invoice, OrganizationMembership, Payment, Receipt, VendorBill
from core.models.financial_auditing.invoice_status_event import InvoiceStatusEvent
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _validate_project_for_user

User = get_user_model()


def _set_invoice_balance_from_payments(invoice: Invoice, *, changed_by: "User") -> None:
    """Recompute an invoice's balance_due and status from its settled payments.

    Sums all settled payments linked to the invoice, updates balance_due,
    and transitions status (paid/partially_paid/sent) as needed.  Bypasses
    model transition validation since balance-driven status changes are
    system-initiated.  Records an audit event when status changes.
    """
    previous_status = invoice.status
    previous_balance = invoice.balance_due

    applied_total = (
        Payment.objects.filter(
            invoice=invoice,
            status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("amount")).get("total")
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


def _set_vendor_bill_balance_from_payments(vendor_bill: VendorBill) -> None:
    """Recompute a vendor bill's balance_due from its settled payments.

    Sums all settled payments linked to the bill and updates balance_due.
    Bill document status is NOT changed — payment coverage is derived at
    read time, not stored as a bill status field.
    """
    applied_total = (
        Payment.objects.filter(
            vendor_bill=vendor_bill,
            status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("amount")).get("total")
        or Decimal("0")
    )

    next_balance = quantize_money(Decimal(str(vendor_bill.total)) - applied_total)
    if next_balance < MONEY_ZERO:
        next_balance = MONEY_ZERO

    vendor_bill.balance_due = next_balance
    vendor_bill._skip_transition_validation = True
    try:
        vendor_bill.save(update_fields=["balance_due", "updated_at"])
    finally:
        vendor_bill._skip_transition_validation = False


def _set_receipt_balance_from_payments(receipt: Receipt) -> None:
    """Recompute a receipt's balance_due from its settled payments.

    Sums all settled payments linked to the receipt and updates
    balance_due.  Floors at zero to prevent negative balances.
    """
    applied_total = (
        Payment.objects.filter(
            receipt=receipt,
            status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("amount")).get("total")
        or Decimal("0")
    )

    next_balance = quantize_money(Decimal(str(receipt.amount)) - applied_total)
    if next_balance < MONEY_ZERO:
        next_balance = MONEY_ZERO

    receipt.balance_due = next_balance
    receipt.save(update_fields=["balance_due", "updated_at"])


def _recalculate_payment_target(payment: Payment, *, changed_by: "User") -> None:
    """Refresh balance_due on the single document linked to this payment.

    Dispatches to the appropriate balance recomputation helper based on
    which FK is set (invoice, vendor_bill, or receipt).
    """
    if payment.invoice_id:
        invoice = Invoice.objects.get(id=payment.invoice_id)
        _set_invoice_balance_from_payments(invoice, changed_by=changed_by)
    elif payment.vendor_bill_id:
        vendor_bill = VendorBill.objects.get(id=payment.vendor_bill_id)
        _set_vendor_bill_balance_from_payments(vendor_bill)
    elif payment.receipt_id:
        receipt = Receipt.objects.get(id=payment.receipt_id)
        _set_receipt_balance_from_payments(receipt)


_OUTBOUND_TARGET_TYPES = {Payment.TargetType.VENDOR_BILL, Payment.TargetType.RECEIPT}


def _direction_target_mismatch(direction: str, target_type: str) -> bool:
    """Return True if the target type is incompatible with the payment direction."""
    if direction == Payment.Direction.INBOUND:
        return target_type != Payment.TargetType.INVOICE
    return target_type not in _OUTBOUND_TARGET_TYPES
