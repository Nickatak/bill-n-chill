from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

User = get_user_model()


class Invoice(models.Model):
    """Client-facing AR invoice issued to the project customer.

    Business workflow:
    - Built from billed scope lines and moved through billing/payment statuses.
    - Represents what the customer sees and pays.
    - Guarded against billing beyond approved scope unless explicitly overridden.
    - `created_by` captures who created/owns the invoice record, not who later
      decided lifecycle transitions.

    Current policy:
    - Lifecycle control: `user-managed` with status-transition guards.
    - Scope guard exceptions are tracked via immutable `InvoiceScopeOverrideEvent`.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        PARTIALLY_PAID = "partially_paid", "Partially Paid"
        PAID = "paid", "Paid"
        OVERDUE = "overdue", "Overdue"
        VOID = "void", "Void"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    # Example: `draft -> sent` is allowed because
    # `Status.SENT` is in `ALLOWED_STATUS_TRANSITIONS[Status.DRAFT]`.
    ALLOWED_STATUS_TRANSITIONS = {
        Status.DRAFT: {Status.SENT, Status.VOID},
        Status.SENT: {
            Status.DRAFT,
            Status.PARTIALLY_PAID,
            Status.PAID,
            Status.OVERDUE,
            Status.VOID,
        },
        Status.PARTIALLY_PAID: {
            Status.SENT,
            Status.PAID,
            Status.OVERDUE,
            Status.VOID,
        },
        Status.PAID: {Status.VOID},
        Status.OVERDUE: {
            Status.PARTIALLY_PAID,
            Status.PAID,
            Status.VOID,
        },
        Status.VOID: set(),
    }

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    customer = models.ForeignKey(
        "Customer",
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    invoice_number = models.CharField(max_length=50)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    issue_date = models.DateField()
    due_date = models.DateField()
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    balance_due = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="invoices",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("project", "invoice_number")
        constraints = [
            models.CheckConstraint(
                condition=Q(due_date__gte=F("issue_date")),
                name="invoice_due_date_on_or_after_issue_date",
            ),
            models.CheckConstraint(
                condition=Q(balance_due__gte=0),
                name="invoice_balance_due_non_negative",
            ),
            models.CheckConstraint(
                condition=Q(status="paid", balance_due=0) | ~Q(status="paid"),
                name="invoice_paid_requires_zero_balance_due",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} {self.invoice_number}"

    @classmethod
    def is_transition_allowed(cls, current_status: str, next_status: str) -> bool:
        if current_status == next_status:
            return True
        return next_status in cls.ALLOWED_STATUS_TRANSITIONS.get(current_status, set())

    def clean(self):
        errors = {}

        if self.issue_date and self.due_date and self.due_date < self.issue_date:
            errors.setdefault("due_date", []).append("Due date must be on or after issue date.")

        if self.balance_due is not None and self.balance_due < 0:
            errors.setdefault("balance_due", []).append("Balance due cannot be negative.")

        if self.project_id and self.customer_id and self.project.customer_id != self.customer_id:
            errors.setdefault("customer", []).append(
                "Invoice customer must match the project customer."
            )

        if self.pk:
            previous_status = (
                type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
            )
            if previous_status and not self.is_transition_allowed(previous_status, self.status):
                errors.setdefault("status", []).append(
                    f"Invalid invoice status transition: {previous_status} -> {self.status}."
                )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        if self.status == self.Status.PAID:
            self.balance_due = 0
            if update_fields is not None:
                update_fields_set = set(update_fields)
                update_fields_set.add("balance_due")
                kwargs["update_fields"] = list(update_fields_set)
        self.full_clean()
        return super().save(*args, **kwargs)


class InvoiceLine(models.Model):
    """Individual billed scope line included on a client invoice.

    Business workflow:
    - Canonical invoice row used for both client-facing and internal-facing views.
    - Client view uses billed descriptors/amounts; internal view can additionally
      use linkage metadata (for example `line_type`, `scope_item`).
    - May reference cost code and/or canonical scope identity for internal traceability.
    """

    class LineType(models.TextChoices):
        SCOPE = "scope", "Scope"
        ADJUSTMENT = "adjustment", "Adjustment"

    invoice = models.ForeignKey(
        "Invoice",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="invoice_lines",
        null=True,
        blank=True,
    )
    scope_item = models.ForeignKey(
        "ScopeItem",
        on_delete=models.PROTECT,
        related_name="invoice_lines",
        null=True,
        blank=True,
    )
    line_type = models.CharField(
        max_length=24,
        choices=LineType.choices,
        default=LineType.SCOPE,
    )
    adjustment_reason = models.CharField(max_length=64, blank=True, default="")
    internal_note = models.TextField(blank=True, default="")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit = models.CharField(max_length=30, default="ea")
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(line_type="adjustment", adjustment_reason__gt="")
                | ~Q(line_type="adjustment"),
                name="invoice_line_adjustment_requires_reason",
            ),
        ]

    def __str__(self) -> str:
        return self.description
