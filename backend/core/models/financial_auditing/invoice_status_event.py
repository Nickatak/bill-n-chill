from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


INVOICE_STATUS_CHOICES = [
    ("draft", "Draft"),
    ("sent", "Sent"),
    ("partially_paid", "Partially Paid"),
    ("paid", "Paid"),
    ("overdue", "Overdue"),
    ("void", "Void"),
]


class InvoiceStatusEvent(models.Model):
    """Audit trail of invoice status transitions.

    Business workflow:
    - Records who changed status, from/to state, when, and why (note).
    - Preserves AR lifecycle decision history for billing traceability.

    Current policy:
    - Lifecycle control: `system-managed` append-only audit log.
    - Visibility: `internal-facing`.
    """

    invoice = models.ForeignKey(
        "Invoice",
        on_delete=models.CASCADE,
        related_name="status_events",
    )
    from_status = models.CharField(
        max_length=32,
        choices=INVOICE_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=INVOICE_STATUS_CHOICES,
    )
    note = models.TextField(blank=True)
    changed_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="invoice_status_events",
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at", "-id"]

    def __str__(self) -> str:
        return f"Invoice {self.invoice_id}: {self.from_status} -> {self.to_status}"
