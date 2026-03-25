"""Project model — primary execution container for delivery and financial workflows."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

from core.models.mixins import StatusTransitionMixin

User = get_user_model()


class Project(StatusTransitionMixin, models.Model):
    """Primary execution container for delivery and financial workflows.

    Business workflow:
    - Starts as a project shell (often via lead conversion).
    - Tracks site/service address separately from customer billing address.
    - Tracks contract baseline/current values.
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
    - ``organization`` FK provides direct org scoping — queries filter on
      ``organization_id=membership.organization_id`` for single-query tenant isolation.
    - `site_address` is job-location context and is distinct from `Customer.billing_address`.
    - Lifecycle control: `user-managed`.
    - Visibility: `internal-facing` primary record with selective customer-facing derivatives.
    """

    class Status(models.TextChoices):
        PROSPECT = "prospect", "Prospect"
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On Hold"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    _status_label = "project"

    ALLOWED_STATUS_TRANSITIONS = {
        Status.PROSPECT: {Status.ACTIVE, Status.CANCELLED},
        Status.ACTIVE: {Status.ON_HOLD, Status.COMPLETED, Status.CANCELLED},
        Status.ON_HOLD: {Status.ACTIVE, Status.COMPLETED, Status.CANCELLED},
        Status.COMPLETED: set(),
        Status.CANCELLED: set(),
    }

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.CASCADE,
        related_name="projects",
    )
    customer = models.ForeignKey(
        "Customer",
        on_delete=models.PROTECT,
        related_name="projects",
    )
    name = models.CharField(max_length=255)
    site_address = models.TextField(blank=True)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.PROSPECT,
        db_index=True,
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
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="projects",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["customer", "name"],
                name="unique_project_name_per_customer",
            ),
        ]

    def __str__(self) -> str:
        return self.name

    def clean(self):
        """Validate status transitions, uniqueness, and prevent activation under an archived customer."""
        errors = {}

        if self.customer_id is not None and self.name:
            if (
                Project.objects.filter(customer_id=self.customer_id, name=self.name)
                .exclude(pk=self.pk)
                .exists()
            ):
                errors.setdefault("name", []).append(
                    "A project with this name already exists for this customer."
                    " Try adding a year or phase (e.g. \"Kitchen Remodel 2026\""
                    " or \"Kitchen Remodel Phase 2\")."
                )

        if self.status in {self.Status.ACTIVE, self.Status.ON_HOLD} and self.customer_id is not None:
            if self.customer.is_archived:
                errors.setdefault("status", []).append(
                    "Cannot set project to active or on hold while customer is archived."
                )

        self.validate_status_transition(errors)

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Run full_clean before persisting to enforce domain constraints."""
        self.full_clean()
        return super().save(*args, **kwargs)
