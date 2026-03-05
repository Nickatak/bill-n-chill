"""VendorBill and VendorBillAllocation models — AP bills from vendors with budget-line attribution."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

from core.models.mixins import StatusTransitionMixin

User = get_user_model()


class VendorBill(StatusTransitionMixin, models.Model):
    """AP bill received from a vendor/subcontractor for project costs.

    Business workflow:
    - Internal payable document (vendor-facing), not customer-facing billing.
    - Tracks AP lifecycle from intake through approval/scheduling/payment.
    - Vendor + bill number must be unique for non-void bills (reuse allowed after void).
    - `created_by` captures who created/owns the bill record, not who performed
      later lifecycle decisions (those belong in immutable decision captures).
    """

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        RECEIVED = "received", "Received"
        APPROVED = "approved", "Approved"
        SCHEDULED = "scheduled", "Scheduled"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    # Example: `received -> approved` is allowed because
    # `Status.APPROVED` is in `ALLOWED_STATUS_TRANSITIONS[Status.RECEIVED]`.
    _status_label = "vendor bill"

    ALLOWED_STATUS_TRANSITIONS = {
        Status.PLANNED: {Status.RECEIVED, Status.VOID},
        Status.RECEIVED: {Status.APPROVED, Status.VOID},
        Status.APPROVED: {Status.SCHEDULED, Status.PAID, Status.VOID},
        Status.SCHEDULED: {Status.PAID, Status.VOID},
        Status.PAID: set(),
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
    )
    bill_number = models.CharField(max_length=50)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.PLANNED,
    )
    received_date = models.DateField(
        null=True,
        blank=True,
        help_text="Date the bill was physically received. Distinct from vendor issue date.",
    )
    issue_date = models.DateField()
    due_date = models.DateField()
    scheduled_for = models.DateField(null=True, blank=True)
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
                "created_by",
                "vendor",
                models.functions.Lower("bill_number"),
                condition=~models.Q(status="void"),
                name="uniq_active_vendor_bill_number_per_user_vendor_ci",
            )
        ]

    def __str__(self) -> str:
        return f"{self.vendor.name} {self.bill_number}"

    def clean(self):
        """Validate due date, scheduled_for requirement, and status transitions."""
        errors = {}

        if self.due_date and self.issue_date and self.due_date < self.issue_date:
            errors.setdefault("due_date", []).append("Due date must be on or after issue date.")

        if self.status == self.Status.SCHEDULED and self.scheduled_for is None:
            errors.setdefault("scheduled_for", []).append("Provide a scheduled payment date.")

        self.validate_status_transition(errors)

        if errors:
            raise ValidationError(errors)

    def build_snapshot(self) -> dict:
        """Point-in-time snapshot for immutable audit records."""
        allocation_rows = list(
            self.allocations.select_related("budget_line", "budget_line__cost_code")
            .order_by("id")
        )
        return {
            "vendor_bill": {
                "id": self.id,
                "project_id": self.project_id,
                "vendor_id": self.vendor_id,
                "bill_number": self.bill_number,
                "status": self.status,
                "received_date": self.received_date.isoformat() if self.received_date else None,
                "issue_date": self.issue_date.isoformat() if self.issue_date else None,
                "due_date": self.due_date.isoformat() if self.due_date else None,
                "scheduled_for": self.scheduled_for.isoformat() if self.scheduled_for else None,
                "subtotal": str(self.subtotal),
                "tax_amount": str(self.tax_amount),
                "shipping_amount": str(self.shipping_amount),
                "total": str(self.total),
                "balance_due": str(self.balance_due),
                "notes": self.notes,
            },
            "allocations": [
                {
                    "vendor_bill_allocation_id": row.id,
                    "budget_line_id": row.budget_line_id,
                    "cost_code_id": row.budget_line.cost_code_id,
                    "cost_code_code": row.budget_line.cost_code.code,
                    "cost_code_name": row.budget_line.cost_code.name,
                    "amount": str(row.amount),
                    "note": row.note,
                }
                for row in allocation_rows
            ],
        }

    def save(self, *args, **kwargs):
        """Run full_clean before persisting to enforce domain constraints."""
        self.full_clean()
        return super().save(*args, **kwargs)


class VendorBillAllocation(models.Model):
    """Allocation row that maps a vendor bill amount to a budget line.

    Business workflow:
    - A single vendor bill can be split across multiple budget lines.
    - Enables accurate committed/actual attribution and line-level history.
    """

    vendor_bill = models.ForeignKey(
        "VendorBill",
        on_delete=models.CASCADE,
        related_name="allocations",
    )
    # BudgetLine is our financial-audit proxy for scope/line-item attribution.
    budget_line = models.ForeignKey(
        "BudgetLine",
        on_delete=models.PROTECT,
        related_name="vendor_bill_allocations",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"Bill {self.vendor_bill_id} -> budget line {self.budget_line_id}: {self.amount}"
