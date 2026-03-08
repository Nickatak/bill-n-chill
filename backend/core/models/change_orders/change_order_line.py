"""ChangeOrderLine model — line-level cost/schedule delta for a change order.

'Original' lines reference an existing budget line from the approved estimate.
'New' lines add entirely new scope via a cost code (no existing budget line).
"""

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from core.models.change_orders.change_order import ChangeOrder
from core.models.financial_auditing.budget_line import BudgetLine


class ChangeOrderLine(models.Model):
    """Line-level change-order delta.

    Two line types:
    - **original**: Adjusts an existing budget line from the approved estimate.
      Requires ``budget_line``; ``cost_code`` is derived from the budget line.
    - **new**: Adds scope not in the original estimate. Requires ``cost_code``;
      ``budget_line`` is null. On CO approval a new BudgetLine is created.

    ``adjustment_reason`` is optional on both types.
    """

    class LineType(models.TextChoices):
        ORIGINAL = "original", "Original"
        NEW = "new", "New"

    change_order = models.ForeignKey(
        "ChangeOrder",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    budget_line = models.ForeignKey(
        "BudgetLine",
        on_delete=models.PROTECT,
        related_name="change_order_lines",
        null=True,
        blank=True,
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="change_order_lines",
        null=True,
        blank=True,
    )
    description = models.CharField(max_length=255, blank=True)
    line_type = models.CharField(
        max_length=24,
        choices=LineType.choices,
        default=LineType.ORIGINAL,
    )
    adjustment_reason = models.CharField(max_length=64, blank=True, default="")
    amount_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    days_delta = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"CO-{self.change_order.family_key} line {self.id} ({self.amount_delta})"

    def clean(self):
        """Validate line type constraints and cross-project integrity."""
        errors = {}

        if self.line_type == self.LineType.ORIGINAL:
            if not self.budget_line_id:
                errors.setdefault("budget_line", []).append(
                    "Original lines must reference a budget line."
                )
            if self.cost_code_id:
                errors.setdefault("cost_code", []).append(
                    "Original lines derive their cost code from the budget line."
                )
        elif self.line_type == self.LineType.NEW:
            if self.budget_line_id:
                errors.setdefault("budget_line", []).append(
                    "New-scope lines must not reference a budget line."
                )
            if not self.cost_code_id:
                errors.setdefault("cost_code", []).append(
                    "New-scope lines must specify a cost code."
                )

        # Cross-project check for original lines with a budget line.
        if self.change_order_id and self.budget_line_id:
            co_project_id = (
                ChangeOrder.objects.filter(id=self.change_order_id)
                .values_list("project_id", flat=True)
                .first()
            )
            budget_line_row = (
                BudgetLine.objects.select_related("budget")
                .filter(id=self.budget_line_id)
                .values("budget__project_id", "budget__status")
                .first()
            )
            if budget_line_row is None:
                errors.setdefault("budget_line", []).append(
                    "Selected budget line does not exist."
                )
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
