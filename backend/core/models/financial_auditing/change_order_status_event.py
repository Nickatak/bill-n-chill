"""ChangeOrderStatusEvent model — immutable audit trail of change-order status transitions."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()

CHANGE_ORDER_STATUS_CHOICES = [
    ("draft", "Draft"),
    ("sent", "Sent"),
    ("approved", "Approved"),
    ("rejected", "Rejected"),
    ("void", "Void"),
]


class ChangeOrderStatusEvent(models.Model):
    """Audit trail of change-order status transitions.

    Business workflow:
    - Records who changed status, from/to state, when, and why (note).
    - Preserves change-order lifecycle decision history for contract traceability.

    Current policy:
    - Lifecycle control: `system-managed` append-only audit log.
    - Visibility: `internal-facing`.
    """

    change_order = models.ForeignKey(
        "ChangeOrder",
        on_delete=models.CASCADE,
        related_name="status_events",
    )
    from_status = models.CharField(
        max_length=32,
        choices=CHANGE_ORDER_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=CHANGE_ORDER_STATUS_CHOICES,
    )
    note = models.TextField(blank=True)
    changed_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="change_order_status_events",
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-changed_at", "-id"]

    @classmethod
    def record(cls, *, change_order, from_status, to_status, note, changed_by, ip_address=None, user_agent=""):
        """Append an immutable change-order status transition row."""
        return cls.objects.create(
            change_order=change_order,
            from_status=from_status,
            to_status=to_status,
            note=note,
            changed_by=changed_by,
            ip_address=ip_address,
            user_agent=user_agent,
        )

    def __str__(self) -> str:
        return f"CO-{self.change_order.family_key}: {self.from_status} -> {self.to_status}"
