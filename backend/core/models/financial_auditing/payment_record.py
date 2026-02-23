from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


PAYMENT_STATUS_CHOICES = [
    ("pending", "Pending"),
    ("settled", "Settled"),
    ("failed", "Failed"),
    ("void", "Void"),
]


class PaymentRecord(models.Model):
    """Immutable audit record for payment lifecycle and provenance captures.

    Business workflow:
    - Captures append-only payment events (creation, updates, status transitions, allocations).
    - Preserves origin metadata so manual entry and automated ingest lanes are distinguishable.
    - Stores point-in-time payment snapshot payload for forensics/replay.

    Current policy:
    - Lifecycle control: `system-managed` append-only capture model.
    - Visibility: `internal-facing`.
    """

    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        UPDATED = "updated", "Updated"
        STATUS_CHANGED = "status_changed", "Status Changed"
        ALLOCATION_APPLIED = "allocation_applied", "Allocation Applied"
        IMPORTED = "imported", "Imported"
        SYNCED = "synced", "Synced"

    class CaptureSource(models.TextChoices):
        MANUAL_UI = "manual_ui", "Manual UI"
        MANUAL_API = "manual_api", "Manual API"
        ACH_WEBHOOK = "ach_webhook", "ACH Webhook"
        PROCESSOR_SYNC = "processor_sync", "Processor Sync"
        CSV_IMPORT = "csv_import", "CSV Import"
        SYSTEM = "system", "System"

    class PaymentRecordQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError("Payment records are immutable and cannot be deleted.")

    objects = PaymentRecordQuerySet.as_manager()

    payment = models.ForeignKey(
        "Payment",
        on_delete=models.PROTECT,
        related_name="records",
    )
    event_type = models.CharField(
        max_length=32,
        choices=EventType.choices,
    )
    capture_source = models.CharField(
        max_length=32,
        choices=CaptureSource.choices,
    )
    source_reference = models.CharField(max_length=128, blank=True, default="")
    from_status = models.CharField(
        max_length=32,
        choices=PAYMENT_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=PAYMENT_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    note = models.TextField(blank=True, default="")
    snapshot_json = models.JSONField(default=dict)
    metadata_json = models.JSONField(default=dict)
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="recorded_payment_records",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("Payment records are immutable and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Payment records are immutable and cannot be deleted.")

    def __str__(self) -> str:
        return f"PAY-{self.payment_id} {self.event_type} ({self.capture_source})"
