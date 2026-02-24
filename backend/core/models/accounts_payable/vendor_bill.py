from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class VendorBill(models.Model):
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
    ALLOWED_STATUS_TRANSITIONS = {
        Status.PLANNED: {Status.RECEIVED, Status.VOID},
        Status.RECEIVED: {Status.APPROVED, Status.VOID},
        Status.APPROVED: {Status.SCHEDULED, Status.PAID, Status.VOID},
        Status.SCHEDULED: {Status.PAID, Status.VOID},
        Status.PAID: {Status.VOID},
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
    issue_date = models.DateField()
    due_date = models.DateField()
    scheduled_for = models.DateField(null=True, blank=True)
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

    @classmethod
    def is_transition_allowed(cls, current_status: str, next_status: str) -> bool:
        if current_status == next_status:
            return True
        return next_status in cls.ALLOWED_STATUS_TRANSITIONS.get(current_status, set())

    def clean(self):
        errors = {}

        if self.due_date and self.issue_date and self.due_date < self.issue_date:
            errors.setdefault("due_date", []).append("Due date must be on or after issue date.")

        if self.status == self.Status.SCHEDULED and self.scheduled_for is None:
            errors.setdefault("scheduled_for", []).append("Provide a scheduled payment date.")

        if self.pk:
            previous_status = (
                type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
            )
            if previous_status and not self.is_transition_allowed(previous_status, self.status):
                errors.setdefault("status", []).append(
                    f"Invalid vendor bill status transition: {previous_status} -> {self.status}."
                )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
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
