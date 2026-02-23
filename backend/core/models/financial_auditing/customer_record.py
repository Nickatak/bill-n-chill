from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class CustomerRecord(models.Model):
    """Immutable audit capture for customer lifecycle events.

    Business workflow:
    - Captures append-only customer events (create and update from intake/workflows).
    - Preserves actor/source metadata for RBAC, compliance, and incident forensics.
    - Stores point-in-time customer snapshot payload for replay.

    Current policy:
    - Lifecycle control: `system-managed` append-only capture model.
    - Visibility: `internal-facing`.
    """

    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        UPDATED = "updated", "Updated"

    class CaptureSource(models.TextChoices):
        MANUAL_UI = "manual_ui", "Manual UI"
        MANUAL_API = "manual_api", "Manual API"
        IMPORT = "import", "Import"
        SYSTEM = "system", "System"

    class CustomerRecordQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError("Customer records are immutable and cannot be deleted.")

    objects = CustomerRecordQuerySet.as_manager()

    customer = models.ForeignKey(
        "Customer",
        on_delete=models.SET_NULL,
        related_name="records",
        null=True,
        blank=True,
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
    note = models.TextField(blank=True, default="")
    snapshot_json = models.JSONField(default=dict)
    metadata_json = models.JSONField(default=dict)
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="recorded_customer_records",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("Customer records are immutable and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Customer records are immutable and cannot be deleted.")

    def __str__(self) -> str:
        return f"CUST-{self.customer_id or 'na'} {self.event_type}"
