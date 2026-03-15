"""Invoice and InvoiceLine models — customer-facing AR billing artifacts."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q
from django.utils.text import slugify

from core.models.mixins import StatusTransitionMixin
from core.utils.tokens import generate_public_token

User = get_user_model()


class Invoice(StatusTransitionMixin, models.Model):
    """Customer-facing AR invoice issued to the project customer.

    Business workflow:
    - Built from billed scope lines and moved through billing/payment statuses.
    - Represents what the customer sees and pays.
    - `created_by` captures who created/owns the invoice record, not who later
      decided lifecycle transitions.

    Current policy:
    - Lifecycle control: `user-managed` with status-transition guards.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        PARTIALLY_PAID = "partially_paid", "Partially Paid"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    # Example: `draft -> sent` is allowed because
    # `Status.SENT` is in `ALLOWED_STATUS_TRANSITIONS[Status.DRAFT]`.
    #
    # Terminal states: paid, void (no outbound transitions).
    # partially_paid can advance to paid, or revert to sent when all
    # allocations are removed (e.g. payment voided).
    _status_label = "invoice"

    ALLOWED_STATUS_TRANSITIONS = {
        Status.DRAFT: {Status.SENT, Status.VOID},
        Status.SENT: {Status.PARTIALLY_PAID, Status.PAID, Status.VOID},
        Status.PARTIALLY_PAID: {Status.PAID, Status.SENT},
        Status.PAID: set(),
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
    sender_name = models.CharField(max_length=255, blank=True, default="")
    sender_email = models.EmailField(blank=True, default="")
    sender_address = models.TextField(blank=True, default="")
    sender_logo_url = models.URLField(blank=True, default="")
    terms_text = models.TextField(blank=True, default="")
    footer_text = models.TextField(blank=True, default="")
    notes_text = models.TextField(blank=True, default="")
    public_token = models.CharField(max_length=24, unique=True, null=True, blank=True)
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

    @property
    def public_slug(self) -> str:
        """URL-safe slug derived from the invoice number."""
        normalized = slugify((self.invoice_number or "").strip())
        return normalized or "invoice"

    @property
    def public_ref(self) -> str:
        """Combined slug--token identifier for public sharing URLs."""
        if not self.public_token:
            return ""
        return f"{self.public_slug}--{self.public_token}"

    def clean(self):
        """Validate dates, balance, customer-project match, and status transitions."""
        errors = {}

        if self.issue_date and self.due_date and self.due_date < self.issue_date:
            errors.setdefault("due_date", []).append("Due date must be on or after issue date.")

        if self.balance_due is not None and self.balance_due < 0:
            errors.setdefault("balance_due", []).append("Balance due cannot be negative.")

        if self.project_id and self.customer_id and self.project.customer_id != self.customer_id:
            errors.setdefault("customer", []).append(
                "Invoice customer must match the project customer."
            )

        if not getattr(self, "_skip_transition_validation", False):
            self.validate_status_transition(errors)

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Auto-generate public token, zero balance on paid status, then validate and persist."""
        update_fields = kwargs.get("update_fields")
        if not self.public_token:
            while True:
                candidate = generate_public_token()
                if not type(self).objects.filter(public_token=candidate).exists():
                    self.public_token = candidate
                    break
            if update_fields is not None:
                update_fields_set = set(update_fields)
                update_fields_set.add("public_token")
                kwargs["update_fields"] = list(update_fields_set)
                update_fields = kwargs["update_fields"]
        if self.status == self.Status.PAID:
            self.balance_due = 0
            if update_fields is not None:
                update_fields_set = set(update_fields)
                update_fields_set.add("balance_due")
                kwargs["update_fields"] = list(update_fields_set)
        self.full_clean()
        return super().save(*args, **kwargs)


class InvoiceLine(models.Model):
    """Individual billed scope line included on a customer invoice.

    Business workflow:
    - Captures quantity/unit/price for billed work.
    - Uses cost codes for internal categorization.
    """

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
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit = models.CharField(max_length=30, default="ea")
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.description
