"""BillingPeriod model — quote-scoped payment milestones."""

from django.db import models


class BillingPeriod(models.Model):
    """Named payment milestone representing a percentage of a quote's total.

    Billing periods define a quote's payment schedule as percentages.
    Dollar amounts are computed at render/invoice time as
    ``quote.grand_total * period.percent / 100`` — nothing financial is
    stored on the period itself.

    Business workflow:
    - Authored on the quote creator (embedded in the quote payload).
    - Each quote owns its own set of billing periods.
    - Percentages across all periods for a quote must sum to 100%.
    - Periods are optional — quotes without periods have no billing schedule.
    """

    quote = models.ForeignKey(
        "Quote",
        on_delete=models.CASCADE,
        related_name="billing_periods",
    )
    description = models.CharField(max_length=255)
    percent = models.DecimalField(max_digits=6, decimal_places=2)
    due_date = models.DateField(null=True, blank=True)
    order = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order"]

    def __str__(self) -> str:
        return f"{self.description} ({self.percent}%)"
