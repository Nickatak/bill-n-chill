from django.db import models


class BudgetLine(models.Model):
    """Internal working-budget line for expected spend by cost category.

    Business workflow:
    - Used by the team/company to plan and track budgeted/actual/committed values.
    - Not a client-facing artifact.
    - Acts as the concrete budget-context row that can optionally anchor to canonical `ScopeItem`.

    Current policy:
    - Relationship chain: `ScopeItem (canonical identity)` -> `BudgetLine (budget context)` ->
      downstream deltas/allocations (for example `ChangeOrderLine`).
    - `ChangeOrderLine` references `BudgetLine` directly (not `ScopeItem`) for deterministic
      contract/budget delta propagation.
    - Line identity (`budget`, `cost_code`) is stable after creation; editable workflow fields are
      handled at API layer (`description`, `budget_amount`) while parent budget is `active`.
    - Lifecycle control: `user-managed` (editable by authorized internal users while budget is active).
    - Visibility: `internal-facing`.
    """

    budget = models.ForeignKey(
        "Budget",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    scope_item = models.ForeignKey(
        "ScopeItem",
        on_delete=models.PROTECT,
        related_name="budget_lines",
        null=True,
        blank=True,
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="budget_lines",
    )
    description = models.CharField(max_length=255)
    budget_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    actual_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    committed_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.cost_code.code} {self.description}"
