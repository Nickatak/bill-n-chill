from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class ScopeItem(models.Model):
    """Canonical non-customer-facing scope-line identity across financial artifacts.

    Business workflow:
    - User-authored estimate lines create/reuse this record during processing.
    - Anchors semantically equivalent lines to one stable ID for analytics/reconciliation.
    - Prevents "same work, new row" drift across estimates, budgets, and later downstream records.

    Current policy:
    - This is not a duplicate of estimate/budget rows; it is the canonical identity layer.
    - Lifecycle control: `system-managed` create/reuse as a side-effect of user estimate authoring.
    - Visibility: `internal-facing` (non-customer-facing).
    """

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="scope_items",
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="scope_items",
    )
    name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255)
    unit = models.CharField(max_length=30, default="ea")
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="scope_items",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        unique_together = ("organization", "cost_code", "normalized_name", "unit")

    def __str__(self) -> str:
        return f"{self.cost_code.code} {self.name} ({self.unit})"
