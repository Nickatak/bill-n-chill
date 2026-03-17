"""VendorBillSnapshot model — immutable point-in-time capture for vendor-bill status transitions."""

from django.contrib.auth import get_user_model
from django.db import models

from core.models.mixins import ImmutableModelMixin

User = get_user_model()


class VendorBillSnapshot(ImmutableModelMixin):
    """Immutable AP document lifecycle snapshot for vendor-bill status transitions.

    Business workflow:
    - Captured when a vendor bill transitions into an auditable document state.
    - Stores point-in-time header + line item snapshot for traceability/replay.
    - Payment status is NOT captured here — it's derived from PaymentAllocations.
      See ``docs/decisions/ap-model-separation.md``.

    Current policy:
    - Append-only (`create` only). Existing rows are immutable.
    - Captured statuses: `received`, `approved`, `disputed`, `closed`, `void`.
    - Lifecycle control: `system-managed`.
    - Visibility: `internal-facing`.
    """

    _immutable_label = "Vendor-bill snapshots"

    class CaptureStatus(models.TextChoices):
        RECEIVED = "received", "Received"
        APPROVED = "approved", "Approved"
        DISPUTED = "disputed", "Disputed"
        CLOSED = "closed", "Closed"
        VOID = "void", "Void"

    vendor_bill = models.ForeignKey(
        "VendorBill",
        on_delete=models.PROTECT,
        related_name="snapshots",
    )
    capture_status = models.CharField(
        max_length=32,
        choices=CaptureStatus.choices,
    )
    snapshot_json = models.JSONField(default=dict)
    acted_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="acted_vendor_bill_snapshots",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    @classmethod
    def record(
        cls,
        *,
        vendor_bill,
        capture_status: str,
        previous_status: str,
        acted_by,
    ):
        """Append an immutable snapshot row for a vendor-bill status transition."""
        snapshot = vendor_bill.build_snapshot()
        snapshot["decision_context"] = {
            "capture_status": capture_status,
            "previous_status": previous_status,
        }
        return cls.objects.create(
            vendor_bill=vendor_bill,
            capture_status=capture_status,
            snapshot_json=snapshot,
            acted_by=acted_by,
        )

    def __str__(self) -> str:
        return f"VB-{self.vendor_bill_id} {self.capture_status}"
