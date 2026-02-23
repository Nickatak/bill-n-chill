from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class ChangeOrderSnapshot(models.Model):
    """Immutable financial-audit snapshot for decision outcomes on a change order.

    Business workflow:
    - Captured when a change order reaches a financially relevant decision state.
    - Stores point-in-time header + line snapshot for traceability.

    Current policy:
    - Append-only (`create` only). Existing rows are immutable.
    - Decision scope is intentionally limited to terminal decision states:
      `approved`, `rejected`, and `void`.
    - Snapshot payload intentionally captures `origin_estimate_version` for historical replay
      and forensic traceability, not as a primary operational field.
    - Lifecycle control: `system-managed`.
    - Visibility: `internal-facing`.
    """

    class DecisionStatus(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        VOID = "void", "Void"

    class ChangeOrderSnapshotQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError("Change-order snapshots are immutable and cannot be deleted.")

    objects = ChangeOrderSnapshotQuerySet.as_manager()

    change_order = models.ForeignKey(
        "ChangeOrder",
        on_delete=models.PROTECT,
        related_name="snapshots",
    )
    decision_status = models.CharField(
        max_length=32,
        choices=DecisionStatus.choices,
    )
    snapshot_json = models.JSONField(default=dict)
    decided_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="decided_change_order_snapshots",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"CO-{self.change_order.family_key} v{self.change_order.revision_number} {self.decision_status}"

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("Change-order snapshots are immutable and cannot be updated.")
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Change-order snapshots are immutable and cannot be deleted.")
