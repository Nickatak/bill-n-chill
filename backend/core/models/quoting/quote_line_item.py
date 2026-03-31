"""QuoteLineItem model — individual priced scope row within a quote version."""

from django.db import models


class QuoteLineItem(models.Model):
    """Customer-facing priced scope row inside a quote version.

    Business workflow:
    - Captures quantity/unit/price/markup for proposed work.
    - Uses cost codes for internal consistency and reporting.

    Current policy:
    - Lifecycle control: `user-managed` through quote authoring/update flows.
    - Visibility: `customer-facing` as part of the quote artifact.
    """

    quote = models.ForeignKey(
        "Quote",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="quote_line_items",
    )
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit = models.CharField(max_length=30, default="ea")
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    markup_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:
        return self.description
