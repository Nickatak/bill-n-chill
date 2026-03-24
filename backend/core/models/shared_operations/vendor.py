"""Vendor model — B2B payee directory record for accounts payable."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Vendor(models.Model):
    """B2B vendor/subcontractor record used for AP bills.

    Business workflow:
    - Represents a business relationship: subcontractors, trades, suppliers
      who send you invoices. Symmetrical to Customer on the AR side.
    - NOT for retail purchases (Home Depot, Lowe's) — those use quick
      expenses (VendorBill with null vendor and store_name field).
    - Maintained internally by the contractor/user.
    - Duplicate warnings are handled at application level by name/email.
    - Duplicate matches are warning-level and allow explicit user override when needed
      (e.g. two different legitimate Vendors with the same name).

    Current policy:
    - Always org-scoped (no system-wide/canonical vendors).
    - Lifecycle control: ``user-managed``.
    - Visibility: ``internal-facing``.
    """

    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    tax_id_last4 = models.CharField(max_length=4, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="vendors",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="vendors",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name
