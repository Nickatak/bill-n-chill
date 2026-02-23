from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class VendorBillSnapshot(models.Model):
    """Immutable AP lifecycle snapshot for financially meaningful vendor-bill statuses.

    Business workflow:
    - Captured when a vendor bill transitions into an auditable AP lifecycle state.
    - Stores point-in-time header + allocation snapshot for traceability/replay.

    Current policy:
    - Append-only (`create` only). Existing rows are immutable.
    - Captured statuses: `received`, `approved`, `scheduled`, `paid`, `void`.
    - Lifecycle control: `system-managed`.
    - Visibility: `internal-facing`.
    """

    class CaptureStatus(models.TextChoices):
        RECEIVED = "received", "Received"
        APPROVED = "approved", "Approved"
        SCHEDULED = "scheduled", "Scheduled"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    class VendorBillSnapshotQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError("Vendor-bill snapshots are immutable and cannot be deleted.")

    objects = VendorBillSnapshotQuerySet.as_manager()

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

    def __str__(self) -> str:
        return f"VB-{self.vendor_bill_id} {self.capture_status}"

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("Vendor-bill snapshots are immutable and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Vendor-bill snapshots are immutable and cannot be deleted.")
