"""Payment model — cash movement records linked directly to AR/AP documents."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

from core.models.mixins import StatusTransitionMixin

User = get_user_model()


class Payment(StatusTransitionMixin, models.Model):
    """Recorded money movement at the organization level (AR inbound or AP outbound).

    Each payment targets exactly one document: an invoice (inbound) or vendor
    bill (outbound).  The payment amount is the full amount applied to that
    document — there is no separate allocation layer.

    Business workflow:
    - `direction` determines valid target type (inbound → invoice, outbound → vendor bill).
    - `organization` is the owning org (required).
    - `customer` identifies the sender (required for inbound, null for outbound).
    - `project` is optional context.
    - `created_by` captures who created/owns the payment record.

    Current policy:
    - Lifecycle control: `user-managed` with transition rules enforced in payment flows.
    - Visibility: `internal-facing` operational ledger object.
    - Immutable event trail captured via `PaymentRecord`.
    """

    class Direction(models.TextChoices):
        INBOUND = "inbound", "Inbound"
        OUTBOUND = "outbound", "Outbound"

    class Method(models.TextChoices):
        CHECK = "check", "Check"
        ZELLE = "zelle", "Zelle"
        ACH = "ach", "ACH"
        CASH = "cash", "Cash"
        WIRE = "wire", "Wire"
        CARD = "card", "Card"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SETTLED = "settled", "Settled"
        VOID = "void", "Void"

    class TargetType(models.TextChoices):
        INVOICE = "invoice", "Invoice"
        VENDOR_BILL = "vendor_bill", "Vendor Bill"

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
        db_index=True,
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    reference_number = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)

    # ── Target document (exactly one FK should be set) ───────────────
    target_type = models.CharField(
        max_length=16,
        choices=TargetType.choices,
        blank=True,
        default="",
    )
    invoice = models.ForeignKey(
        "Invoice",
        on_delete=models.PROTECT,
        related_name="target_payments",
        null=True,
        blank=True,
    )
    vendor_bill = models.ForeignKey(
        "VendorBill",
        on_delete=models.PROTECT,
        related_name="target_payments",
        null=True,
        blank=True,
    )
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
    def target_id(self) -> int | None:
        """Return the ID of the linked target document."""
        return self.invoice_id or self.vendor_bill_id

    def clean(self):
        """Validate status transitions and target consistency."""
        errors = {}
        self.validate_status_transition(errors)

        # Ensure exactly one target FK is set when target_type is present
        fk_count = sum([
            self.invoice_id is not None,
            self.vendor_bill_id is not None,
        ])
        if self.target_type and fk_count != 1:
            errors["target_type"] = "Exactly one target FK must be set."

        if self.target_type == self.TargetType.INVOICE and not self.invoice_id:
            errors["invoice"] = "Invoice FK required for target_type 'invoice'."
        if self.target_type == self.TargetType.VENDOR_BILL and not self.vendor_bill_id:
            errors["vendor_bill"] = "Vendor bill FK required for target_type 'vendor_bill'."

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
                "target_type": self.target_type,
                "target_id": self.target_id,
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
