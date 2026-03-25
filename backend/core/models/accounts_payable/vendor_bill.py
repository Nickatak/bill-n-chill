"""VendorBill and VendorBillLine models — AP bills from vendors."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

from core.models.mixins import StatusTransitionMixin

User = get_user_model()


class VendorBill(StatusTransitionMixin, models.Model):
    """AP bill or quick expense — inbound payable document.

    Business workflow:
    - All bills reference a Vendor (the unified payee entity).
      Vendor is optional to allow draft/scan-in-progress states.
    - bill_number is optional — quick expenses and retail purchases
      typically have no bill number.
    - Bills track document lifecycle only (open → closed).
      Payment status is derived from PaymentAllocation coverage, not a bill
      status. See ``docs/decisions/ap-model-separation.md``.
    - `created_by` captures who created/owns the record, not who performed
      later lifecycle decisions (those belong in immutable decision captures).
    """

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        DISPUTED = "disputed", "Disputed"
        CLOSED = "closed", "Closed"
        VOID = "void", "Void"

    _status_label = "vendor bill"

    ALLOWED_STATUS_TRANSITIONS = {
        Status.OPEN: {Status.DISPUTED, Status.CLOSED, Status.VOID},
        Status.DISPUTED: {Status.OPEN, Status.VOID},
        Status.CLOSED: set(),
        Status.VOID: set(),
    }

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="vendor_bills",
    )
    vendor = models.ForeignKey(
        "Vendor",
        on_delete=models.PROTECT,
        related_name="vendor_bills",
        null=True,
        blank=True,
    )
    bill_number = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.OPEN,
        db_index=True,
    )
    received_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date the bill was physically received. Distinct from vendor issue date.",
    )
    issue_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    shipping_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    balance_due = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="vendor_bills",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                "project",
                "vendor",
                models.functions.Lower("bill_number"),
                condition=(
                    ~models.Q(status="void")
                    & ~models.Q(bill_number="")
                    & models.Q(vendor__isnull=False)
                ),
                name="uniq_active_vendor_bill_number_per_project_vendor_ci",
            )
        ]

    def __str__(self) -> str:
        if self.vendor_id:
            parts = [self.vendor.name]
            if self.bill_number:
                parts.append(self.bill_number)
            return " ".join(parts)
        return "Expense"

    def clean(self):
        """Validate date constraints and status transitions."""
        errors = {}

        if self.due_date and self.issue_date and self.due_date < self.issue_date:
            errors.setdefault("due_date", []).append("Due date must be on or after issue date.")

        if not getattr(self, "_skip_transition_validation", False):
            self.validate_status_transition(errors)

        if errors:
            raise ValidationError(errors)

    def build_snapshot(self) -> dict:
        """Point-in-time snapshot for immutable audit records."""
        line_rows = list(
            self.line_items.select_related("cost_code").order_by("id")
        )
        return {
            "vendor_bill": {
                "id": self.id,
                "project_id": self.project_id,
                "vendor_id": self.vendor_id,
                "vendor_name": self.vendor.name if self.vendor_id else "",
                "bill_number": self.bill_number,
                "status": self.status,
                "received_date": self.received_date.isoformat() if self.received_date else None,
                "issue_date": self.issue_date.isoformat() if self.issue_date else None,
                "due_date": self.due_date.isoformat() if self.due_date else None,
                "subtotal": str(self.subtotal),
                "tax_amount": str(self.tax_amount),
                "shipping_amount": str(self.shipping_amount),
                "total": str(self.total),
                "balance_due": str(self.balance_due),
                "notes": self.notes,
            },
            "line_items": [
                {
                    "vendor_bill_line_id": row.id,
                    "cost_code_id": row.cost_code_id,
                    "cost_code_code": row.cost_code.code if row.cost_code else None,
                    "cost_code_name": row.cost_code.name if row.cost_code else None,
                    "description": row.description,
                    "quantity": str(row.quantity),
                    "unit_price": str(row.unit_price),
                    "amount": str(row.amount),
                }
                for row in line_rows
            ],
        }

    def save(self, *args, **kwargs):
        """Run full_clean before persisting to enforce domain constraints."""
        self.full_clean()
        return super().save(*args, **kwargs)


class VendorBillLine(models.Model):
    """Individual line item on a vendor bill.

    Business workflow:
    - Transcription of a vendor's invoice line: description, quantity ×
      unit_price = amount.
    - ``amount`` is a stored computed field set automatically on save
      (quantity × unit_price).  bulk_create callers must supply it directly.
    - Optional cost code tag for internal classification (input convenience
      only — authoritative cost attribution lives on PaymentAllocation).
    - See ``docs/decisions/ap-model-separation.md``.
    """

    vendor_bill = models.ForeignKey(
        "VendorBill",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="vendor_bill_lines",
        null=True,
        blank=True,
    )
    description = models.CharField(max_length=255, blank=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=4, default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"Bill {self.vendor_bill_id} line: {self.description}"

    def save(self, *args, **kwargs):
        """Compute amount = quantity × unit_price before persisting."""
        self.amount = self.quantity * self.unit_price
        super().save(*args, **kwargs)
