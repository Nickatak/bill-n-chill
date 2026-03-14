"""ChangeOrderLine model — line-level cost/schedule delta for a change order."""

from django.db import models


class ChangeOrderLine(models.Model):
    """Line-level change-order delta.

    Each line captures a cost and/or schedule adjustment with a cost code
    for categorization. The ``description`` field serves as the free-text
    scope note; ``adjustment_reason`` is retained for API/data compatibility
    but is no longer surfaced in the UI.
    """

    change_order = models.ForeignKey(
        "ChangeOrder",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="change_order_lines",
    )
    description = models.CharField(max_length=255, blank=True)
    adjustment_reason = models.CharField(max_length=64, blank=True, default="")
    amount_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    days_delta = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"CO-{self.change_order.family_key} line {self.id} ({self.amount_delta})"
