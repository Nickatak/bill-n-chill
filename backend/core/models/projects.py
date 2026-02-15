from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Project(models.Model):
    """Primary execution container for delivery and financial workflows.

    Business workflow:
    - Starts as a project shell (often via lead conversion).
    - Tracks contract baseline/current values and planning dates.
    - Owns downstream estimates, budgets, change orders, and invoices.
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
    """Reusable financial classification used across estimating/budgeting/billing.

    Business workflow:
    - Managed per company/user as a shared catalog.
    - Applied to estimate lines, budget lines, and invoice lines for rollups.
    """

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
