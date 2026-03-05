from django.contrib.auth import get_user_model
from django.db import models

from core.models.mixins import ImmutableModelMixin

User = get_user_model()


class PaymentAllocationRecord(ImmutableModelMixin):
    """Immutable audit record for payment-allocation provenance captures.

    Business workflow:
    - Captures append-only allocation events that apply payment amounts to AR/AP targets.
    - Preserves actor/source metadata for RBAC and forensics.
    - Stores point-in-time allocation/payment snapshot payload for replay.

    Current policy:
    - Lifecycle control: `system-managed` append-only capture model.
    - Visibility: `internal-facing`.
    """

    class EventType(models.TextChoices):
        APPLIED = "applied", "Applied"
        REVERSED = "reversed", "Reversed"

    class CaptureSource(models.TextChoices):
        MANUAL_UI = "manual_ui", "Manual UI"
        MANUAL_API = "manual_api", "Manual API"
        ACH_WEBHOOK = "ach_webhook", "ACH Webhook"
        PROCESSOR_SYNC = "processor_sync", "Processor Sync"
        CSV_IMPORT = "csv_import", "CSV Import"
        SYSTEM = "system", "System"

    _immutable_label = "Payment allocation records"

    class TargetType(models.TextChoices):
        INVOICE = "invoice", "Invoice"
        VENDOR_BILL = "vendor_bill", "Vendor Bill"

    payment = models.ForeignKey(
        "Payment",
        on_delete=models.PROTECT,
        related_name="allocation_records",
    )
    payment_allocation = models.ForeignKey(
        "PaymentAllocation",
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
    target_type = models.CharField(
        max_length=16,
        choices=TargetType.choices,
    )
    target_object_id = models.PositiveBigIntegerField()
    applied_amount = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.TextField(blank=True, default="")
    snapshot_json = models.JSONField(default=dict)
    metadata_json = models.JSONField(default=dict)
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="recorded_payment_allocation_records",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    @classmethod
    def record(
        cls,
        *,
        payment,
        allocation,
        event_type: str,
        capture_source: str,
        target_type: str,
        target_object_id: int,
        recorded_by,
        source_reference: str = "",
        note: str = "",
        metadata: dict | None = None,
    ):
        """Append an immutable audit row for a payment allocation event."""
        return cls.objects.create(
            payment=payment,
            payment_allocation=allocation,
            event_type=event_type,
            capture_source=capture_source,
            source_reference=source_reference,
            target_type=target_type,
            target_object_id=target_object_id,
            applied_amount=allocation.applied_amount,
            note=note,
            snapshot_json=allocation.build_snapshot(),
            metadata_json=metadata or {},
            recorded_by=recorded_by,
        )

    def __str__(self) -> str:
        return f"PAY-{self.payment_id} {self.event_type} {self.target_type}:{self.target_object_id}"
