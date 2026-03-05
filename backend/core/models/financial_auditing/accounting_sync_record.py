from django.contrib.auth import get_user_model
from django.db import models

from core.models.mixins import ImmutableModelMixin

User = get_user_model()


ACCOUNTING_SYNC_STATUS_CHOICES = [
    ("queued", "Queued"),
    ("success", "Success"),
    ("failed", "Failed"),
]


class AccountingSyncRecord(ImmutableModelMixin):
    """Immutable audit record for accounting synchronization lifecycle captures.

    Business workflow:
    - Captures append-only accounting-sync events for create/status/retry outcomes.
    - Preserves actor/source metadata for RBAC and operational forensics.
    - Stores point-in-time sync-event snapshot payload for replay.

    Current policy:
    - Lifecycle control: `system-managed` append-only capture model.
    - Visibility: `internal-facing`.
    """

    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        STATUS_CHANGED = "status_changed", "Status Changed"
        RETRIED = "retried", "Retried"
        IMPORTED = "imported", "Imported"
        SYNCED = "synced", "Synced"

    _immutable_label = "Accounting sync records"

    class CaptureSource(models.TextChoices):
        MANUAL_UI = "manual_ui", "Manual UI"
        MANUAL_API = "manual_api", "Manual API"
        JOB_RUNNER = "job_runner", "Job Runner"
        WEBHOOK = "webhook", "Webhook"
        SYSTEM = "system", "System"

    accounting_sync_event = models.ForeignKey(
        "AccountingSyncEvent",
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
        max_length=20,
        choices=ACCOUNTING_SYNC_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=20,
        choices=ACCOUNTING_SYNC_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    note = models.TextField(blank=True, default="")
    snapshot_json = models.JSONField(default=dict)
    metadata_json = models.JSONField(default=dict)
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="recorded_accounting_sync_records",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"SYNC-{self.accounting_sync_event_id} {self.event_type}"
