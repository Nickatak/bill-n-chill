from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class LeadContact(models.Model):
    """Pre-project intake record captured before a customer/project exists.

    Business workflow:
    - Created quickly in the field/office as the first sales-contact artifact.
    - May be duplicate-resolved before progressing.
    - Can be converted into a Customer + Project shell.
    """

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
    phone = models.CharField(max_length=50, blank=True)
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
        contact_hint = self.phone or self.email or "no-contact"
        return f"{self.full_name} ({contact_hint})"


class Customer(models.Model):
    """Client/owner account that owns one or more projects.

    Business workflow:
    - Usually created/reused during lead conversion.
    - Serves as the customer anchor for projects and owner invoices.
    """

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
