"""Receipt and Store models — standalone project expense records."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Store(models.Model):
    """Org-scoped retail store/source label for receipt categorization.

    Business workflow:
    - Lightweight lookup record for where money was spent (e.g. "Home Depot").
    - NOT a vendor — no contact info, no B2B relationship, no invoices.
    - Auto-created on receipt submission when a new name is entered.
    - Org-scoped: each organization builds its own store list.
    - See ``docs/decisions/receipt-vendor-separation.md``.

    Current policy:
    - Lifecycle control: ``system-managed`` (auto-created via receipt flow).
    - Visibility: ``internal-facing``.
    """

    name = models.CharField(max_length=255)
    # Has a unique constraint for lowercase.
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="stores",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="stores",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(
                "organization",
                models.functions.Lower("name"),
                name="uniq_store_name_per_org_ci",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class Receipt(models.Model):
    """Standalone expense record for a project purchase.

    Business workflow:
    - Records an expense that already happened (money already left).
    - NOT a bill — no document lifecycle, no vendor relationship, no line items.
    - Owns its payment directly (OneToOne) — no allocation indirection.
    - ``store`` is an optional FK to a Store lookup record for consistent naming.
    - See ``docs/decisions/receipt-vendor-separation.md``.

    Current policy:
    - Lifecycle control: ``user-managed``, created once, no status transitions.
    - Visibility: ``internal-facing``.
    """

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="receipts",
    )
    payment = models.OneToOneField(
        "Payment",
        on_delete=models.PROTECT,
        related_name="receipt",
    )
    store = models.ForeignKey(
        "Store",
        on_delete=models.PROTECT,
        related_name="receipts",
        null=True,
        blank=True,
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    receipt_date = models.DateField()
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="receipts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-receipt_date", "-created_at"]

    def __str__(self) -> str:
        label = self.store.name if self.store_id else "Receipt"
        return f"{label} ${self.amount}"
