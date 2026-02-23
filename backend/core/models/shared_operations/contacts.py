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
    - `status` currently has minimal UX usage and is primarily lifecycle scaffolding.
      Full status-driven lead handling is deferred until intake workflow expansion.
    - `source` is currently low-impact metadata; richer usage is deferred until
      importer/integration workflows (for example CRM or form ingestion) are expanded.
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

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    # Example: `new_contact -> qualified` is allowed because
    # `Status.QUALIFIED` is in `ALLOWED_STATUS_TRANSITIONS[Status.NEW_CONTACT]`.
    ALLOWED_STATUS_TRANSITIONS = {
        Status.NEW_CONTACT: {Status.QUALIFIED, Status.PROJECT_CREATED, Status.ARCHIVED},
        Status.QUALIFIED: {Status.PROJECT_CREATED, Status.ARCHIVED},
        Status.PROJECT_CREATED: {Status.ARCHIVED},
        Status.ARCHIVED: set(),
    }

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
        constraints = [
            models.CheckConstraint(
                condition=~Q(status="project_created") | (
                    Q(converted_customer__isnull=False)
                    & Q(converted_project__isnull=False)
                    & Q(converted_at__isnull=False)
                ),
                name="lead_project_created_requires_conversion_links",
            ),
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
            models.CheckConstraint(
                condition=(
                    Q(converted_customer__isnull=True)
                    & Q(converted_project__isnull=True)
                    & Q(converted_at__isnull=True)
                )
                | Q(status__in=["project_created", "archived"]),
                name="lead_conversion_links_status_gate",
            ),
        ]

    @classmethod
    def is_transition_allowed(cls, current_status: str, next_status: str) -> bool:
        if current_status == next_status:
            return True
        return next_status in cls.ALLOWED_STATUS_TRANSITIONS.get(current_status, set())

    def clean(self):
        errors = {}

        conversion_values = [
            self.converted_customer_id is not None,
            self.converted_project_id is not None,
            self.converted_at is not None,
        ]
        has_any_conversion_link = any(conversion_values)
        has_complete_conversion_link = all(conversion_values)

        if self.status == self.Status.PROJECT_CREATED and not has_complete_conversion_link:
            errors.setdefault("status", []).append(
                "project_created requires converted customer, project, and converted_at."
            )

        if has_any_conversion_link and not has_complete_conversion_link:
            errors.setdefault("converted_customer", []).append(
                "Conversion links must be set together (customer, project, converted_at)."
            )

        if has_complete_conversion_link and self.status not in {
            self.Status.PROJECT_CREATED,
            self.Status.ARCHIVED,
        }:
            errors.setdefault("status", []).append(
                "Converted leads must be project_created or archived."
            )

        if self.pk:
            previous_status = (
                type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
            )
            if previous_status and not self.is_transition_allowed(previous_status, self.status):
                errors.setdefault("status", []).append(
                    f"Invalid lead contact status transition: {previous_status} -> {self.status}."
                )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        contact_hint = self.phone or self.email or "no-contact"
        return f"{self.full_name} ({contact_hint})"


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
