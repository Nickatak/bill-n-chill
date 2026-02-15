from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class AccountingSyncEvent(models.Model):
    """Sync event log for accounting push/pull activity and retries."""

    class Provider(models.TextChoices):
        QUICKBOOKS_ONLINE = "quickbooks_online", "QuickBooks Online"

    class Direction(models.TextChoices):
        PUSH = "push", "Push"
        PULL = "pull", "Pull"

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="accounting_sync_events",
    )
    provider = models.CharField(max_length=50, choices=Provider.choices)
    object_type = models.CharField(max_length=50)
    object_id = models.PositiveIntegerField(null=True, blank=True)
    direction = models.CharField(max_length=10, choices=Direction.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)
    external_id = models.CharField(max_length=100, blank=True)
    error_message = models.TextField(blank=True)
    retry_count = models.PositiveIntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="accounting_sync_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.provider} {self.object_type} {self.status}"
