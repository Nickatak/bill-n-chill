from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class FinancialAuditEvent(models.Model):
    """DEPRECATED: Immutable project-scoped financial activity index row.

    Deprecation status:
    - This model is currently retained for timeline/index read paths and backward compatibility.
    - It is not the canonical source of financial truth.
    - Canonical financial replay/forensics should come from domain-specific immutable
      capture models (for example `Budget`, `ChangeOrderSnapshot`) and any future
      workflow-specific immutable capture artifacts.
    - Planned direction is to remove this table after timeline/reporting paths are
      fully migrated to domain-specific capture models.
    - Do not add new product dependencies or expand usage of this model.
    """

    class EventType(models.TextChoices):
        ESTIMATE_STATUS_CHANGED = "estimate_status_changed", "Estimate Status Changed"
        BUDGET_CONVERTED = "budget_converted", "Budget Converted"
        CHANGE_ORDER_UPDATED = "change_order_updated", "Change Order Updated"
        INVOICE_UPDATED = "invoice_updated", "Invoice Updated"
        VENDOR_BILL_UPDATED = "vendor_bill_updated", "Vendor Bill Updated"
        PAYMENT_UPDATED = "payment_updated", "Payment Updated"
        PAYMENT_ALLOCATED = "payment_allocated", "Payment Allocated"
        INVOICE_SCOPE_OVERRIDE = "invoice_scope_override", "Invoice Scope Override"

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="financial_audit_events",
    )
    event_type = models.CharField(max_length=64, choices=EventType.choices)
    object_type = models.CharField(max_length=64)
    object_id = models.PositiveIntegerField()
    from_status = models.CharField(max_length=32, blank=True)
    to_status = models.CharField(max_length=32, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    note = models.TextField(blank=True)
    metadata_json = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="financial_audit_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("FinancialAuditEvent is immutable and cannot be updated.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("FinancialAuditEvent is immutable and cannot be deleted.")

    def __str__(self) -> str:
        return f"{self.event_type} ({self.object_type}:{self.object_id})"
