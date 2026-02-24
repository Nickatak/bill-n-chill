from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

User = get_user_model()


class LeadContact(models.Model):
    """Pre-project intake record captured before a customer/project exists.

    Workflow role:
    - Created quickly in the field/office as the first sales-contact entity.
    - Captures intake analytics context (who captured it, when, and intake source/channel).
    - May be duplicate-resolved before progressing.
    - Can be converted into a Customer + Project shell when intake is qualified.

    Current policy:
    - Lead conversion is intended to be idempotent at the API layer.
    - Converted leads keep references to created/reused customer and project shell.
    - Lifecycle control: `user-managed` intake with conversion side-effects.
    - Visibility: `internal-facing`.

    Notes:
    - `initial_contract_value` is optional intake-time context and may be used when
      creating the project baseline during conversion.
    - Lead lifecycle is represented by:
      - `is_archived` for active/inactive intent.
      - Conversion links (`converted_customer`, `converted_project`, `converted_at`)
        for project-converted state.
    - `source` is currently low-impact metadata; richer usage is deferred until
      importer/integration workflows (for example CRM or form ingestion) are expanded.
    """

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
    initial_contract_value = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)
    source = models.CharField(
        max_length=32,
        choices=Source.choices,
        default=Source.FIELD_MANUAL,
    )
    is_archived = models.BooleanField(default=False)
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
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(converted_customer__isnull=True)
                    & Q(converted_project__isnull=True)
                    & Q(converted_at__isnull=True)
                )
                | (
                    Q(converted_customer__isnull=False)
                    & Q(converted_project__isnull=False)
                    & Q(converted_at__isnull=False)
                ),
                name="lead_conversion_links_all_or_none",
            ),
        ]

    def clean(self):
        errors = {}

        conversion_values = [
            self.converted_customer_id is not None,
            self.converted_project_id is not None,
            self.converted_at is not None,
        ]
        has_any_conversion_link = any(conversion_values)
        has_complete_conversion_link = all(conversion_values)

        if has_any_conversion_link and not has_complete_conversion_link:
            errors.setdefault("converted_customer", []).append(
                "Conversion links must be set together (customer, project, converted_at)."
            )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        contact_hint = self.phone or self.email or "no-contact"
        return f"{self.full_name} ({contact_hint})"

    @property
    def has_project(self) -> bool:
        return self.converted_project_id is not None


class Customer(models.Model):
    """Client/owner account that owns one or more projects.

    Workflow role:
    - Canonical contact-representation object used by the Contacts management page.
    - Usually created/reused during lead conversion.
    - Serves as the customer anchor for projects and owner invoices.

    Current policy:
    - Customer records are user-scoped via `created_by` in current implementation.
    - `billing_address` is billing-only and intentionally separate from
      project-level `site_address`/service location data.
    - Deduplication/reuse behavior is handled by intake conversion logic, not by
      a hard unique constraint on this model.
    - Lifecycle control: `user-managed`.
    - Visibility: `internal-facing`.
    """

    display_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    billing_address = models.CharField(max_length=255, blank=True)
    is_archived = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="customers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def clean(self):
        errors = {}

        if self.is_archived and self.pk:
            has_blocking_project = self.projects.filter(
                status__in=["active", "on_hold"]
            ).exists()
            if has_blocking_project:
                errors.setdefault("is_archived", []).append(
                    "Cannot archive customer while a project is active or on hold."
                )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.display_name
