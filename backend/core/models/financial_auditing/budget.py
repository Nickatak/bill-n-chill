from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Budget(models.Model):
    """Internal execution budget baseline derived from an approved estimate.

    Business workflow:
    - Auto-created when an estimate is accepted/approved by the client.
    - This is completely internal, the user will never be able to modify this directly.
    - Stores immutable baseline snapshot of the source estimate.
    - Exposes mutable working lines for internal planning/tracking.
    - Distinction: client approves Estimate; team manages Budget internally.

    Current policy:
    - Exactly one `active` budget should exist per project/user working set.
    - Older budgets are moved to `superseded` (historical/read-only) when a new active budget is created.
    - Lifecycle control: `system-managed`.
    - Visibility: `internal-facing`.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUPERSEDED = "superseded", "Superseded"

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="budgets",
    )
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    source_estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.PROTECT,
        related_name="budgets",
    )
    baseline_snapshot_json = models.JSONField(default=dict)
    approved_change_order_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="budgets",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.project.name} budget ({self.status})"
