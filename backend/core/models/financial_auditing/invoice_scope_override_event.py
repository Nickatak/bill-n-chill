from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class InvoiceScopeOverrideEvent(models.Model):
    """Immutable record for explicit over-scope invoice billing exceptions.

    Business workflow:
    - Created only when projected billed total exceeds approved scope and override is used.
    - Captures note and financial snapshot for accountability.
    - Treated as financial-auditing evidence, not mutable workflow authoring state.
    """

    invoice = models.ForeignKey(
        "Invoice",
        on_delete=models.CASCADE,
        related_name="scope_override_events",
    )
    note = models.TextField()
    approved_scope_limit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    projected_billed_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    overage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="invoice_scope_override_events",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"Invoice {self.invoice_id} scope override"
