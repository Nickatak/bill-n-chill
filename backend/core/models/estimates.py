from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Estimate(models.Model):
    """Client-facing scope and price proposal for a project.

    Business workflow:
    - Pre-baseline commercial artifact discussed with the client.
    - Revised by version/status lifecycle until client approval.
    - Approved estimate can be converted into an internal Budget baseline.
    - Distinction: an approved Estimate is still client-facing; Budget is internal.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        ARCHIVED = "archived", "Archived"

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="estimates",
    )
    # Family version is 1-based (v1 is the first estimate) and unique per
    # (project, title) estimate family.
    version = models.PositiveIntegerField()
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    title = models.CharField(max_length=255, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    markup_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="estimates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("project", "title", "version")

    def __str__(self) -> str:
        return f"{self.project.name} v{self.version}"


class EstimateLineItem(models.Model):
    """Client-facing priced scope row inside an estimate version.

    Business workflow:
    - Captures quantity/unit/cost/markup for proposed work.
    - Uses cost codes for internal consistency and reporting.
    """

    estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.CASCADE,
        related_name="line_items",
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


class EstimateStatusEvent(models.Model):
    """Audit trail of estimate status transitions.

    Business workflow:
    - Records who changed status, from/to state, when, and why (note).
    - Preserves decision history for sales/approval traceability.
    """

    estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.CASCADE,
        related_name="status_events",
    )
    from_status = models.CharField(
        max_length=32,
        choices=Estimate.Status.choices,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=Estimate.Status.choices,
    )
    note = models.TextField(blank=True)
    changed_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="estimate_status_events",
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at", "-id"]

    def __str__(self) -> str:
        return f"Estimate {self.estimate_id}: {self.from_status} -> {self.to_status}"
