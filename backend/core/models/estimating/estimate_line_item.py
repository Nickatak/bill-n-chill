"""EstimateLineItem model — individual priced scope row within an estimate version."""

from django.db import models


class EstimateLineItem(models.Model):
    """Customer-facing priced scope row inside an estimate version.

    Business workflow:
    - Captures quantity/unit/cost/markup for proposed work.
    - Uses cost codes for internal consistency and reporting.

    Current policy:
    - Lifecycle control: `user-managed` through estimate authoring/update flows.
    - Visibility: `customer-facing` as part of the estimate artifact.
    """

    estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    scope_item = models.ForeignKey(
        "ScopeItem",
        on_delete=models.PROTECT,
        related_name="estimate_line_items",
        null=True,
        blank=True,
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="estimate_line_items",
    )
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit = models.CharField(max_length=30, default="ea")
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    markup_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.description
