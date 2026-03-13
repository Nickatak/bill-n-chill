"""Payment and PaymentAllocation models — cash movement records with AR/AP allocation."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Sum

from core.models.mixins import StatusTransitionMixin

User = get_user_model()


class Payment(StatusTransitionMixin, models.Model):
    """Recorded money movement at the organization level (AR inbound or AP outbound).

    Business workflow:
    - Represents a single cash movement entry, independent from specific invoice/bill rows.
    - `organization` is the owning org (required).
    - `customer` identifies the sender (required for inbound, null for outbound).
    - `project` is optional context.
    - `direction` determines valid allocation lane (`inbound` to invoices, `outbound` to vendor bills).
    - Can be partially allocated across multiple targets after settlement.
    - Allocations can target invoices/bills from any project in the same org.
    - `created_by` captures who created/owns the payment record.

    Current policy:
    - Lifecycle control: `user-managed` with transition rules enforced in payment flows.
    - Visibility: `internal-facing` operational ledger object.
    - Immutable event trail captured via `PaymentRecord` and `PaymentAllocationRecord`.
    """

    class Direction(models.TextChoices):
        INBOUND = "inbound", "Inbound"
        OUTBOUND = "outbound", "Outbound"

    class Method(models.TextChoices):
        ACH = "ach", "ACH"
        CARD = "card", "Card"
        CHECK = "check", "Check"
        WIRE = "wire", "Wire"
        ZELLE = "zelle", "Zelle"
        CASH = "cash", "Cash"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SETTLED = "settled", "Settled"
        VOID = "void", "Void"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    # Example: `pending -> settled` is allowed because
    # `Status.SETTLED` is in `ALLOWED_STATUS_TRANSITIONS[Status.PENDING]`.
    _status_label = "payment"

    ALLOWED_STATUS_TRANSITIONS = {
        Status.PENDING: {Status.SETTLED, Status.VOID},
        Status.SETTLED: {Status.VOID},
        Status.VOID: set(),
    }

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="payments",
    )
    customer = models.ForeignKey(
        "Customer",
        on_delete=models.PROTECT,
        related_name="payments",
        null=True,
        blank=True,
    )
    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="payments",
        null=True,
        blank=True,
    )
    direction = models.CharField(max_length=16, choices=Direction.choices)
    method = models.CharField(max_length=16, choices=Method.choices)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.SETTLED,
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    reference_number = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-payment_date", "-created_at"]

    @property
    def allocated_total(self) -> Decimal:
        """Sum of all applied allocation amounts for this payment."""
        return (
            self.allocations.aggregate(total=Sum("applied_amount")).get("total")
            or Decimal("0")
        )

    @property
    def unapplied_amount(self) -> Decimal:
        """Remaining payment amount not yet allocated to invoices or bills."""
        remainder = Decimal(str(self.amount)) - self.allocated_total
        return remainder if remainder > Decimal("0") else Decimal("0")

    def clean(self):
        """Validate status transitions before save."""
        errors = {}
        self.validate_status_transition(errors)
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Run full_clean before persisting to enforce domain constraints."""
        self.full_clean()
        return super().save(*args, **kwargs)

    def build_snapshot(self) -> dict:
        """Point-in-time snapshot for immutable audit records."""
        return {
            "payment": {
                "id": self.id,
                "organization_id": self.organization_id,
                "customer_id": self.customer_id,
                "project_id": self.project_id,
                "direction": self.direction,
                "method": self.method,
                "status": self.status,
                "amount": str(self.amount),
                "payment_date": self.payment_date.isoformat() if self.payment_date else None,
                "reference_number": self.reference_number,
                "notes": self.notes,
                "allocated_total": str(self.allocated_total),
                "unapplied_amount": str(self.unapplied_amount),
            }
        }

    def __str__(self) -> str:
        if self.customer_id:
            label = self.customer.display_name
        elif self.project_id:
            label = self.project.name
        else:
            label = "Unassigned"
        return f"{label} {self.direction} {self.amount}"


class PaymentAllocation(models.Model):
    """Applied amount from one payment to one invoice or vendor bill.

    Business workflow:
    - Allocation join row attributing part of a payment to a concrete AR/AP target.
    - Supports split allocations from one payment across multiple targets.
    - Drives recalculation of target balances and payment unapplied remainder.
    - Exactly one target FK is expected based on `target_type`.

    Current policy:
    - Lifecycle control: `system-managed` via allocation endpoint write paths.
    - Visibility: `internal-facing` reconciliation artifact.
    """

    class TargetType(models.TextChoices):
        INVOICE = "invoice", "Invoice"
        VENDOR_BILL = "vendor_bill", "Vendor Bill"

    payment = models.ForeignKey(
        "Payment",
        on_delete=models.CASCADE,
        related_name="allocations",
    )
    target_type = models.CharField(max_length=16, choices=TargetType.choices)
    invoice = models.ForeignKey(
        "Invoice",
        on_delete=models.CASCADE,
        related_name="payment_allocations",
        null=True,
        blank=True,
    )
    vendor_bill = models.ForeignKey(
        "VendorBill",
        on_delete=models.CASCADE,
        related_name="payment_allocations",
        null=True,
        blank=True,
    )
    applied_amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="payment_allocations",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def build_snapshot(self) -> dict:
        """Point-in-time snapshot for immutable audit records (includes parent payment)."""
        return {
            "payment": self.payment.build_snapshot()["payment"],
            "allocation": {
                "id": self.id,
                "target_type": self.target_type,
                "invoice_id": self.invoice_id,
                "vendor_bill_id": self.vendor_bill_id,
                "applied_amount": str(self.applied_amount),
                "created_by_id": self.created_by_id,
                "created_at": self.created_at.isoformat() if self.created_at else None,
            },
        }

    def __str__(self) -> str:
        return f"Payment {self.payment_id} -> {self.target_type} {self.applied_amount}"
