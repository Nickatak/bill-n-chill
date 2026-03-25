"""Domain-specific helpers for payment views."""

import logging

from decimal import Decimal
from typing import Any

logger = logging.getLogger(__name__)

from django.contrib.auth import get_user_model
from django.db.models import Model, QuerySet, Sum

from core.models import Invoice, OrganizationMembership, Payment, VendorBill
from core.models.financial_auditing.invoice_status_event import InvoiceStatusEvent
from core.utils.money import MONEY_ZERO, quantize_money

User = get_user_model()


def _prefetch_payment_qs(queryset: QuerySet) -> QuerySet:
    """Apply standard select/prefetch for payment serialization.

    Prevents N+1 queries when serializing payments with their
    related customer, project, invoice, and vendor bill.
    """
    return queryset.select_related(
        "customer",
        "project",
        "invoice",
        "vendor_bill",
    )


def _set_invoice_balance_from_payments(invoice: Invoice, *, changed_by: "User") -> None:
    """Recompute an invoice's balance_due and status from its settled payments.

    Sums all settled payments linked to the invoice, updates balance_due,
    and auto-transitions between sent/outstanding as needed.  Bypasses
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

    # Auto-transition SENT ↔ OUTSTANDING based on payment activity.
    # CLOSED and VOID are terminal — never touched by payment logic.
    if invoice.status not in {Invoice.Status.VOID, Invoice.Status.CLOSED}:
        if applied_total > MONEY_ZERO and invoice.status == Invoice.Status.SENT:
            invoice.status = Invoice.Status.OUTSTANDING
            update_fields.append("status")
        elif applied_total <= MONEY_ZERO and invoice.status == Invoice.Status.OUTSTANDING:
            invoice.status = Invoice.Status.SENT
            update_fields.append("status")

    # System-driven status changes (e.g. sent → outstanding on first payment)
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
        else:
            note = "Payment recorded — invoice outstanding."

        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=previous_status,
            to_status=invoice.status,
            note=note,
            changed_by=changed_by,
        )
        logger.info("Invoice balance-driven status change: id=%s %s (%s → %s) balance=$%s", invoice.id, invoice.invoice_number, previous_status, invoice.status, invoice.balance_due)


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


def _recalculate_payment_target(payment: Payment, *, changed_by: "User") -> None:
    """Refresh balance_due on the single document linked to this payment.

    Dispatches to the appropriate balance recomputation helper based on
    which FK is set (invoice or vendor_bill).
    """
    if payment.invoice_id:
        invoice = Invoice.objects.get(id=payment.invoice_id)
        _set_invoice_balance_from_payments(invoice, changed_by=changed_by)
    elif payment.vendor_bill_id:
        vendor_bill = VendorBill.objects.get(id=payment.vendor_bill_id)
        _set_vendor_bill_balance_from_payments(vendor_bill)


_OUTBOUND_TARGET_TYPES: set[str] = {Payment.TargetType.VENDOR_BILL}


def _direction_target_mismatch(direction: str, target_type: str) -> bool:
    """Return True if the target type is incompatible with the payment direction.

    Inbound payments can only target invoices.  Outbound payments can
    target vendor bills.
    """
    if direction == Payment.Direction.INBOUND:
        return target_type != Payment.TargetType.INVOICE
    return target_type not in _OUTBOUND_TARGET_TYPES


# ---------------------------------------------------------------------------
# Target resolution and balance recalculation (imported by views)
# ---------------------------------------------------------------------------


def _target_error(fields: dict[str, list[str]]) -> dict:
    """Build a standard validation error payload for target resolution failures."""
    return {"error": {"code": "validation_error", "message": "Invalid payment target.", "fields": fields}}


def _resolve_and_link_target(
    data: dict[str, Any],
    payment_kwargs: dict[str, Any],
    membership: OrganizationMembership,
) -> tuple[Model | None, dict | None]:
    """Resolve ``target_type`` + ``target_id`` from payload and populate payment FK kwargs.

    Both fields are required — every payment must allocate to exactly one
    document (invoice or vendor bill).  Validates that the target
    exists, is org-scoped, and is in a linkable status.  Returns
    ``(target, None)`` on success or ``(None, error_payload)`` on failure.
    """
    target_type = data.get("target_type", "")
    target_id = data.get("target_id")
    direction = payment_kwargs.get("direction", "")

    if not target_type or not target_id:
        return None, _target_error({"target_type": ["target_type and target_id are required. Every payment must allocate to a document."]})

    if _direction_target_mismatch(direction, target_type):
        return None, _target_error({"target_type": ["target_type does not match payment direction."]})

    payment_kwargs["target_type"] = target_type

    if target_type == Payment.TargetType.INVOICE:
        target = Invoice.objects.filter(
            id=target_id,
            project__organization_id=membership.organization_id,
        ).first()
        if not target:
            return None, _target_error({"target_id": ["Invoice not found in this organization."]})
        if target.status == Invoice.Status.VOID:
            return None, _target_error({"target_id": ["Cannot link payment to a void invoice."]})
        if target.status == Invoice.Status.DRAFT:
            return None, _target_error({"target_id": ["Cannot record payment against a draft invoice. Send it first."]})
        payment_kwargs["invoice"] = target
        return target, None

    if target_type == Payment.TargetType.VENDOR_BILL:
        target = VendorBill.objects.filter(
            id=target_id,
            project__organization_id=membership.organization_id,
        ).first()
        if not target:
            return None, _target_error({"target_id": ["Vendor bill not found in this organization."]})
        if target.status == VendorBill.Status.VOID:
            return None, _target_error({"target_id": ["Cannot link payment to a void vendor bill."]})
        payment_kwargs["vendor_bill"] = target
        return target, None

    return None, _target_error({"target_type": ["Invalid target type."]})


def _recalculate_target_balance(
    target: Model,
    target_type: str,
    changed_by: "User",
) -> None:
    """Recalculate the balance on a resolved target after payment creation.

    Dispatches to the appropriate balance helper based on target type.
    """
    if target_type == Payment.TargetType.INVOICE:
        _set_invoice_balance_from_payments(target, changed_by=changed_by)
    elif target_type == Payment.TargetType.VENDOR_BILL:
        _set_vendor_bill_balance_from_payments(target)
