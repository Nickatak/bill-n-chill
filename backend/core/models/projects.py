from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class Project(models.Model):
    """Primary execution container for delivery and financial workflows.

    Business workflow:
    - Starts as a project shell (often via lead conversion).
    - Tracks site/service address separately from customer billing address.
    - Tracks contract baseline/current values and planning dates.
    - Owns downstream estimates, budgets, change orders, and invoices.

    Status intent:
    - `prospect`: shell exists but execution has not started.
    - `active`: project is currently in-flight.
    - `on_hold`: temporarily paused without closing the project.
    - `completed`: closed as delivered.
    - `cancelled`: closed without completion.

    Current policy:
    - `contract_value_original` is set at project creation and treated as immutable.
    - `contract_value_current` is system-derived financial truth (for example approved CO deltas).
    - `site_address` is job-location context and is distinct from `Customer.billing_address`.
    """

    class Status(models.TextChoices):
        PROSPECT = "prospect", "Prospect"
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On Hold"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    customer = models.ForeignKey(
        "Customer",
        on_delete=models.PROTECT,
        related_name="projects",
    )
    name = models.CharField(max_length=255)
    site_address = models.CharField(
        max_length=255,
        blank=True,
    )
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
    """Reusable financial classification used across estimating/budgeting/billing line items.

    Business workflow:
    - Managed per company/user as a shared catalog.
    - Applied to estimate lines, budget lines, and invoice lines for rollups.

    Current policy:
    - Cost codes are scoped by `organization` and unique per organization catalog.
    - Code values are immutable identifiers in practice; renames should keep semantic continuity.
    - `is_active=False` deprecates selection in UI flows without deleting historical references.
    - Cost codes are non-deletable by policy to preserve historical financial traceability.
    """

    class CostCodeQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError(
                "Cost codes are non-deletable. Set is_active=false to retire a code."
            )

    objects = CostCodeQuerySet.as_manager()

    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="cost_codes",
        null=True,
        blank=True,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="cost_codes",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code", "name"]
        unique_together = ("organization", "code")

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"

    def delete(self, using=None, keep_parents=False):
        raise ValidationError(
            "Cost codes are non-deletable. Set is_active=false to retire a code."
        )
