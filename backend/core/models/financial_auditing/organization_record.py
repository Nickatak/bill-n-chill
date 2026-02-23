from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class OrganizationRecord(models.Model):
    """Immutable audit capture for organization lifecycle events.

    Business workflow:
    - Captures append-only organization events (bootstrap creation and metadata updates).
    - Preserves actor/source metadata for RBAC, compliance, and incident forensics.
    - Stores point-in-time organization snapshot payload for replay.

    Current policy:
    - Lifecycle control: `system-managed` append-only capture model.
    - Visibility: `internal-facing`.
    """

    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        UPDATED = "updated", "Updated"

    class CaptureSource(models.TextChoices):
        AUTH_BOOTSTRAP = "auth_bootstrap", "Auth Bootstrap"
        MANUAL_UI = "manual_ui", "Manual UI"
        MANUAL_API = "manual_api", "Manual API"
        SYSTEM = "system", "System"

    class OrganizationRecordQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError("Organization records are immutable and cannot be deleted.")

    objects = OrganizationRecordQuerySet.as_manager()

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="organization_records",
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
        related_name="recorded_organization_records",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("Organization records are immutable and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Organization records are immutable and cannot be deleted.")

    def __str__(self) -> str:
        return f"ORG-{self.organization_id} {self.event_type}"
