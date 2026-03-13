"""ChangeOrderSnapshot model — immutable point-in-time capture for change-order decisions."""

from django.contrib.auth import get_user_model
from django.db import models

from core.models.mixins import ImmutableModelMixin

User = get_user_model()


class ChangeOrderSnapshot(ImmutableModelMixin):
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

    _immutable_label = "Change-order snapshots"

    class DecisionStatus(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        VOID = "void", "Void"

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
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at", "-id"]

    @classmethod
    def record(
        cls,
        *,
        change_order,
        decision_status: str,
        previous_status: str,
        applied_financial_delta,
        decided_by,
        ip_address=None,
        user_agent="",
    ):
        """Append an immutable snapshot row for a change-order decision event."""
        snapshot = change_order.build_snapshot()
        snapshot["decision_context"] = {
            "decision_status": decision_status,
            "previous_status": previous_status,
            "applied_financial_delta": str(applied_financial_delta),
        }
        return cls.objects.create(
            change_order=change_order,
            decision_status=decision_status,
            snapshot_json=snapshot,
            decided_by=decided_by,
            ip_address=ip_address,
            user_agent=user_agent,
        )

    def __str__(self) -> str:
        return f"CO-{self.change_order.family_key} v{self.change_order.revision_number} {self.decision_status}"
