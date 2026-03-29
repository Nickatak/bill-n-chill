"""EstimateSection model — named divider within an estimate's flat ordering."""

from django.db import models


class EstimateSection(models.Model):
    """Named section divider that shares an ordering space with line items.

    Sections act as visual grouping boundaries within an estimate. Each section's
    subtotal is the sum of line_total for all line items ordered between this
    section and the next section (or end of list). Subtotals are computed and
    stored on create/update — they become part of the immutable financial record
    once the estimate leaves draft.

    Business workflow:
    - Lifecycle control: `user-managed` through estimate authoring/update flows.
    - Visibility: `customer-facing` as part of the estimate artifact.
    """

    estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.CASCADE,
        related_name="sections",
    )
    name = models.CharField(max_length=200)
    order = models.PositiveIntegerField()
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order"]

    def __str__(self) -> str:
        return self.name
