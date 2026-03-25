"""Vendor model — org-scoped payee record for accounts payable."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Vendor(models.Model):
    """Org-scoped payee record used for AP bills and quick expenses.

    Business workflow:
    - Unified payee entity: subcontractors, suppliers, retail stores,
      and any other source of outbound payments.
    - Only ``name`` is required. All other fields (email, phone,
      tax_id_last4, notes) are optional — users fill them in when
      the relationship warrants it.
    - Auto-created by name via ``get_or_create_by_name()`` in the
      quick expense flow.
    - Duplicate warnings are handled at application level by name/email.

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

    @classmethod
    def get_or_create_by_name(cls, organization_id, name, created_by):
        """Find or create a Vendor by name within an org (case-insensitive).

        Returns the standard ``(instance, created)`` tuple from
        ``get_or_create``. Matching is case-insensitive; the stored
        name preserves the casing of the first submission.
        """
        return cls.objects.get_or_create(
            organization_id=organization_id,
            name__iexact=name,
            defaults={
                "name": name,
                "organization_id": organization_id,
                "created_by": created_by,
            },
        )

    def __str__(self) -> str:
        return self.name
