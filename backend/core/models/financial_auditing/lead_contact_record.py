from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


LEAD_CONTACT_STATUS_CHOICES = [
    ("new_contact", "New Contact"),
    ("qualified", "Qualified"),
    ("project_created", "Project Created"),
    ("archived", "Archived"),
]


class LeadContactRecord(models.Model):
    """Immutable audit capture for customer-intake lifecycle and conversion events.

    Business workflow:
    - Captures append-only customer-intake events (create, update, status change, conversion, delete).
    - Preserves actor/source metadata for RBAC, compliance, and incident forensics.
    - Stores point-in-time intake snapshot payload for replay.

    Current policy:
    - Lifecycle control: `system-managed` append-only capture model.
    - Visibility: `internal-facing`.
    """

    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        UPDATED = "updated", "Updated"
        STATUS_CHANGED = "status_changed", "Status Changed"
        CONVERTED = "converted", "Converted"
        DELETED = "deleted", "Deleted"

    class CaptureSource(models.TextChoices):
        MANUAL_UI = "manual_ui", "Manual UI"
        MANUAL_API = "manual_api", "Manual API"
        IMPORT = "import", "Import"
        SYSTEM = "system", "System"

    class LeadContactRecordQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError("Customer intake records are immutable and cannot be deleted.")

    objects = LeadContactRecordQuerySet.as_manager()

    intake_record_id = models.PositiveBigIntegerField(
        db_index=True,
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
    from_status = models.CharField(
        max_length=32,
        choices=LEAD_CONTACT_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=LEAD_CONTACT_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    note = models.TextField(blank=True, default="")
    snapshot_json = models.JSONField(default=dict)
    metadata_json = models.JSONField(default=dict)
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="recorded_lead_contact_records",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("Customer intake records are immutable and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Customer intake records are immutable and cannot be deleted.")

    def __str__(self) -> str:
        return f"INTAKE-{self.intake_record_id or 'na'} {self.event_type}"
