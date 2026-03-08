"""Customer model — mutable client/owner record anchoring projects and invoices."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class Customer(models.Model):
    """Client/owner account that owns one or more projects.

    Workflow role:
    - Canonical customer record used by the Customers management page.
    - Usually created/reused during lead conversion.
    - Serves as the customer anchor for projects and owner invoices.

    Tenant isolation:
    - ``organization`` FK provides direct org scoping — queries filter on
      ``organization_id=membership.organization_id`` for single-query tenant
      isolation without resolving the membership user-ID fan-out.

    Current policy:
    - `billing_address` is billing-only and intentionally separate from
      project-level `site_address`/service location data.
    - Deduplication/reuse behavior is handled by intake conversion logic, not by
      a hard unique constraint on this model.
    - Lifecycle control: `user-managed`.
    - Visibility: `internal-facing`.
    """

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.CASCADE,
        related_name="customers",
    )
    display_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    billing_address = models.TextField(blank=True)
    is_archived = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="customers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def clean(self):
        """Prevent archiving a customer with active or on-hold projects."""
        errors = {}

        if self.is_archived and self.pk:
            has_blocking_project = self.projects.filter(
                status__in=["active", "on_hold"]
            ).exists()
            if has_blocking_project:
                errors.setdefault("is_archived", []).append(
                    "Cannot archive customer while a project is active or on hold."
                )

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Run full_clean before persisting to enforce domain constraints."""
        self.full_clean()
        return super().save(*args, **kwargs)

    def build_snapshot(self) -> dict:
        """Point-in-time snapshot for immutable audit records."""
        return {
            "customer": {
                "id": self.id,
                "display_name": self.display_name,
                "email": self.email,
                "phone": self.phone,
                "billing_address": self.billing_address,
                "is_archived": self.is_archived,
                "created_by_id": self.created_by_id,
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            }
        }

    def __str__(self) -> str:
        return self.display_name
