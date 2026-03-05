"""ChangeOrderLine model — line-level cost/schedule delta tied to an active budget line."""

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from core.models.change_orders.change_order import ChangeOrder
from core.models.financial_auditing.budget_line import BudgetLine


class ChangeOrderLine(models.Model):
    """Line-level change-order delta tied to an active budget line.

    Business workflow:
    - Stores semantic scope deltas within a change-order family/version.
    - Maps each delta to a `BudgetLine` for deterministic budget propagation.
    - Indirect canonical lineage: `ChangeOrderLine -> BudgetLine -> ScopeItem` (when present).
      This model intentionally does not reference `ScopeItem` directly.
    - Enables iterative rollout from aggregate CO deltas to line-level controls.

    Current policy:
    - Lifecycle control: `user-managed` via change-order editing flows.
    - Visibility: `internal-facing`.
    """

    class LineType(models.TextChoices):
        SCOPE = "scope", "Scope"
        ADJUSTMENT = "adjustment", "Adjustment"

    change_order = models.ForeignKey(
        "ChangeOrder",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    budget_line = models.ForeignKey(
        "BudgetLine",
        on_delete=models.PROTECT,
        related_name="change_order_lines",
    )
    description = models.CharField(max_length=255, blank=True)
    line_type = models.CharField(
        max_length=24,
        choices=LineType.choices,
        default=LineType.SCOPE,
    )
    adjustment_reason = models.CharField(max_length=64, blank=True, default="")
    amount_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    days_delta = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["change_order", "budget_line"],
                name="co_line_unique_budget_line_per_change_order",
            ),
            models.CheckConstraint(
                condition=Q(line_type="adjustment", adjustment_reason__gt="")
                | ~Q(line_type="adjustment"),
                name="co_line_adjustment_requires_reason",
            ),
        ]

    def __str__(self) -> str:
        return f"CO-{self.change_order.family_key} line {self.id} ({self.amount_delta})"

    def clean(self):
        """Ensure budget line belongs to the same project and an active budget."""
        errors = {}

        if self.change_order_id and self.budget_line_id:
            co_project_id = (
                ChangeOrder.objects.filter(id=self.change_order_id).values_list("project_id", flat=True).first()
            )
            budget_line_row = (
                BudgetLine.objects.select_related("budget")
                .filter(id=self.budget_line_id)
                .values("budget__project_id", "budget__status")
                .first()
            )
            if budget_line_row is None:
                errors.setdefault("budget_line", []).append("Selected budget line does not exist.")
            else:
                if budget_line_row["budget__project_id"] != co_project_id:
                    errors.setdefault("budget_line", []).append(
                        "Budget line must belong to the same project as the change order."
                    )
                if budget_line_row["budget__status"] != "active":
                    errors.setdefault("budget_line", []).append(
                        "Budget line must belong to an active budget."
                    )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Run full_clean before persisting to enforce domain constraints."""
        self.full_clean()
        return super().save(*args, **kwargs)
