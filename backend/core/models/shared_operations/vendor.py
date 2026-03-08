"""Vendor model — payee directory record for accounts payable and commitments."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Vendor(models.Model):
    """Payee directory record used for AP bills and commitments.

    Business workflow:
    - Maintained internally by the contractor/user.
    - Plain English: this is who the user/company pays (money out), not who pays us.
    - Reused for downstream AP and commitment workflows.
    - Duplicate warnings are handled at application level by name/email.
    - Duplicate matches are warning-level and allow explicit user override when needed
        (e.g. two different legitimate Vendors with the same name).

    Current policy:
    - `vendor_type` is currently advisory metadata (label/filter intent only),
      not a hard behavior switch in workflow logic yet.
    - It is intentionally retained for future extensions
      (for example type-specific defaults/rules/reporting).
    - `is_canonical` currently marks seeded system-default vendor entries
      (practically the built-in retail catalog flag), not user-created records.
    - Vendor rows are scoped by `organization`; legacy null-org rows remain readable
      via transitional fallback in query helpers.
    - Lifecycle control: `user-managed` for normal rows; seeded canonical rows are `system-managed`.
    - Visibility: `internal-facing`.
    """

    class VendorType(models.TextChoices):
        TRADE = "trade", "Trade"
        RETAIL = "retail", "Retail"

    name = models.CharField(max_length=255)
    vendor_type = models.CharField(
        max_length=20,
        choices=VendorType.choices,
        default=VendorType.TRADE,
    )
    is_canonical = models.BooleanField(default=False)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    tax_id_last4 = models.CharField(max_length=4, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="vendors",
        null=True,
        blank=True,
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
        constraints = [
            models.CheckConstraint(
                condition=models.Q(organization__isnull=False) | models.Q(is_canonical=True),
                name="vendor_org_required_unless_canonical",
            ),
        ]

    def __str__(self) -> str:
        return self.name
