"""VendorBillStatusEvent model — immutable audit trail of vendor bill status transitions."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

VENDOR_BILL_STATUS_CHOICES = [
    ("open", "Open"),
    ("disputed", "Disputed"),
    ("closed", "Closed"),
    ("void", "Void"),
]


class VendorBillStatusEvent(models.Model):
    """Audit trail of vendor bill status transitions.

    Business workflow:
    - Records who changed status, from/to state, when, and why (note).
    - Preserves AP lifecycle decision history for payables traceability.

    Current policy:
    - Lifecycle control: `system-managed` append-only audit log.
    - Visibility: `internal-facing`.
    """

    vendor_bill = models.ForeignKey(
        "VendorBill",
        on_delete=models.CASCADE,
        related_name="status_events",
    )
    from_status = models.CharField(
        max_length=32,
        choices=VENDOR_BILL_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=VENDOR_BILL_STATUS_CHOICES,
    )
    note = models.TextField(blank=True)
    changed_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="vendor_bill_status_events",
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-changed_at", "-id"]

    @classmethod
    def record(cls, *, vendor_bill, from_status, to_status, note, changed_by):
        """Append an immutable vendor bill status transition row."""
        return cls.objects.create(
            vendor_bill=vendor_bill,
            from_status=from_status,
            to_status=to_status,
            note=note,
            changed_by=changed_by,
        )

    def __str__(self) -> str:
        return f"VB {self.vendor_bill_id}: {self.from_status} -> {self.to_status}"
