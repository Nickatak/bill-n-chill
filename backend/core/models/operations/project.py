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
    - Lifecycle control: `user-managed`.
    - Visibility: `internal-facing` primary record with selective client-facing derivatives.
    """

    class Status(models.TextChoices):
        PROSPECT = "prospect", "Prospect"
        ACTIVE = "active", "Active"
        ON_HOLD = "on_hold", "On Hold"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    ALLOWED_STATUS_TRANSITIONS = {
        Status.PROSPECT: {Status.ACTIVE, Status.CANCELLED},
        Status.ACTIVE: {Status.ON_HOLD, Status.COMPLETED, Status.CANCELLED},
        Status.ON_HOLD: {Status.ACTIVE, Status.COMPLETED, Status.CANCELLED},
        Status.COMPLETED: set(),
        Status.CANCELLED: set(),
    }

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

    @classmethod
    def is_transition_allowed(cls, current_status: str, next_status: str) -> bool:
        if current_status == next_status:
            return True
        return next_status in cls.ALLOWED_STATUS_TRANSITIONS.get(current_status, set())

    def clean(self):
        errors = {}

        if (
            self.start_date_planned
            and self.end_date_planned
            and self.end_date_planned < self.start_date_planned
        ):
            errors.setdefault("end_date_planned", []).append(
                "Planned end date must be on or after planned start date."
            )

        if self.pk:
            previous_status = (
                type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
            )
            if previous_status and not self.is_transition_allowed(previous_status, self.status):
                errors.setdefault("status", []).append(
                    f"Invalid project status transition: {previous_status} -> {self.status}."
                )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
