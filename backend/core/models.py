from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class LeadContact(models.Model):
    class Status(models.TextChoices):
        NEW_CONTACT = "new_contact", "New Contact"
        QUALIFIED = "qualified", "Qualified"
        PROJECT_CREATED = "project_created", "Project Created"
        ARCHIVED = "archived", "Archived"

    class Source(models.TextChoices):
        FIELD_MANUAL = "field_manual", "Field Manual"
        OFFICE_MANUAL = "office_manual", "Office Manual"
        IMPORT = "import", "Import"
        WEB_FORM = "web_form", "Web Form"
        REFERRAL = "referral", "Referral"
        OTHER = "other", "Other"

    full_name = models.CharField(max_length=255)
    phone = models.CharField(max_length=50)
    project_address = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.NEW_CONTACT,
    )
    source = models.CharField(
        max_length=32,
        choices=Source.choices,
        default=Source.FIELD_MANUAL,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="lead_contacts",
    )
    converted_customer = models.ForeignKey(
        "Customer",
        on_delete=models.SET_NULL,
        related_name="source_leads",
        null=True,
        blank=True,
    )
    converted_project = models.ForeignKey(
        "Project",
        on_delete=models.SET_NULL,
        related_name="source_leads",
        null=True,
        blank=True,
    )
    converted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.full_name} ({self.phone})"


class Customer(models.Model):
    display_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    billing_address = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="customers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.display_name


class Project(models.Model):
    class Status(models.TextChoices):
        PROSPECT = "prospect", "Prospect"
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On Hold"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="projects",
    )
    name = models.CharField(max_length=255)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.PROSPECT,
    )
    contract_value_original = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    contract_value_current = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    start_date_planned = models.DateField(null=True, blank=True)
    end_date_planned = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="projects",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.name


class CostCode(models.Model):
    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="cost_codes",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code", "name"]
        unique_together = ("created_by", "code")

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"


class Estimate(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        ARCHIVED = "archived", "Archived"

    project = models.ForeignKey(
        Project,
        on_delete=models.PROTECT,
        related_name="estimates",
    )
    version = models.PositiveIntegerField()
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    title = models.CharField(max_length=255, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    markup_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="estimates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("project", "version")

    def __str__(self) -> str:
        return f"{self.project.name} v{self.version}"


class EstimateLineItem(models.Model):
    estimate = models.ForeignKey(
        Estimate,
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    cost_code = models.ForeignKey(
        CostCode,
        on_delete=models.PROTECT,
        related_name="estimate_line_items",
    )
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit = models.CharField(max_length=30, default="ea")
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    markup_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.description


class EstimateStatusEvent(models.Model):
    estimate = models.ForeignKey(
        Estimate,
        on_delete=models.CASCADE,
        related_name="status_events",
    )
    from_status = models.CharField(
        max_length=32,
        choices=Estimate.Status.choices,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=Estimate.Status.choices,
    )
    note = models.TextField(blank=True)
    changed_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="estimate_status_events",
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at", "-id"]

    def __str__(self) -> str:
        return f"Estimate {self.estimate_id}: {self.from_status} -> {self.to_status}"
