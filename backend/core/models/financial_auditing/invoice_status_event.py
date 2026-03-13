"""InvoiceStatusEvent model — immutable audit trail of invoice status transitions."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


INVOICE_STATUS_CHOICES = [
    ("draft", "Draft"),
    ("sent", "Sent"),
    ("partially_paid", "Partially Paid"),
    ("paid", "Paid"),
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
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-changed_at", "-id"]

    @classmethod
    def record(cls, *, invoice, from_status, to_status, note, changed_by, ip_address=None, user_agent=""):
        """Append an immutable invoice status transition row."""
        return cls.objects.create(
            invoice=invoice,
            from_status=from_status,
            to_status=to_status,
            note=note,
            changed_by=changed_by,
            ip_address=ip_address,
            user_agent=user_agent,
        )

    def __str__(self) -> str:
        return f"Invoice {self.invoice_id}: {self.from_status} -> {self.to_status}"
