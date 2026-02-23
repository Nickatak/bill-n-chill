from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

ESTIMATE_STATUS_CHOICES = [
    ("draft", "Draft"),
    ("sent", "Sent"),
    ("approved", "Approved"),
    ("rejected", "Rejected"),
    ("void", "Void"),
    ("archived", "Archived"),
]


class EstimateStatusEvent(models.Model):
    """Audit trail of estimate status transitions.

    Business workflow:
    - Records who changed status, from/to state, when, and why (note).
    - Preserves decision history for sales/approval traceability.

    Current policy:
    - Lifecycle control: `system-managed` append-only audit log.
    - Visibility: `internal-facing`.
    """

    estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.CASCADE,
        related_name="status_events",
    )
    from_status = models.CharField(
        max_length=32,
        choices=ESTIMATE_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=ESTIMATE_STATUS_CHOICES,
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
