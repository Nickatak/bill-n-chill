from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Invoice(models.Model):
    """Client-facing AR invoice issued to the project customer.

    Business workflow:
    - Built from billed scope lines and moved through billing/payment statuses.
    - Represents what the customer sees and pays.
    - Guarded against billing beyond approved scope unless explicitly overridden.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        PARTIALLY_PAID = "partially_paid", "Partially Paid"
        PAID = "paid", "Paid"
        OVERDUE = "overdue", "Overdue"
        VOID = "void", "Void"

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

    def __str__(self) -> str:
        return f"{self.project.name} {self.invoice_number}"


class InvoiceLine(models.Model):
    """Individual billed scope line included on a client invoice.

    Business workflow:
    - Captures bill quantity/unit/price and contributes to invoice totals.
    - May reference cost code for internal consistency/reporting.
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


class InvoiceScopeOverrideEvent(models.Model):
    """Audit event when over-scope billing is explicitly allowed.

    Business workflow:
    - Created only when projected billed total exceeds approved scope and override is used.
    - Captures note and financial snapshot for accountability.
    """

    invoice = models.ForeignKey(
        "Invoice",
        on_delete=models.CASCADE,
        related_name="scope_override_events",
    )
    note = models.TextField()
    approved_scope_limit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    projected_billed_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    overage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="invoice_scope_override_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"Invoice {self.invoice_id} scope override"


class VendorBill(models.Model):
    """AP bill received from a vendor/subcontractor for project costs.

    Business workflow:
    - Internal payable document (vendor-facing), not client-facing billing.
    - Tracks AP lifecycle from intake through approval/scheduling/payment.
    - Duplicate warnings are handled by vendor + bill number at application level.
    """

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        RECEIVED = "received", "Received"
        APPROVED = "approved", "Approved"
        SCHEDULED = "scheduled", "Scheduled"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

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

    def __str__(self) -> str:
        return f"{self.vendor.name} {self.bill_number}"


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
