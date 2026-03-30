"""BillingPeriod model — estimate-scoped payment milestones."""

from django.db import models


class BillingPeriod(models.Model):
    """Named payment milestone representing a percentage of an estimate's total.

    Billing periods define an estimate's payment schedule as percentages.
    Dollar amounts are computed at render/invoice time as
    ``estimate.grand_total * period.percent / 100`` — nothing financial is
    stored on the period itself.

    Business workflow:
    - Authored on the estimate creator (embedded in the estimate payload).
    - Each estimate owns its own set of billing periods.
    - Percentages across all periods for an estimate must sum to 100%.
    - Periods are optional — estimates without periods have no billing schedule.
    """

    estimate = models.ForeignKey(
        "Estimate",
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
