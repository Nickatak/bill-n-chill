"""Store model — org-scoped retail store/source label for expense categorization."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Store(models.Model):
    """Org-scoped retail store/source label for expense categorization.

    Business workflow:
    - Lightweight lookup record for where money was spent (e.g. "Home Depot").
    - NOT a vendor — no contact info, no B2B relationship, no invoices.
    - Auto-created on expense submission when a new name is entered.
    - Org-scoped: each organization builds its own store list.

    Current policy:
    - Lifecycle control: ``system-managed`` (auto-created via expense flow).
    - Visibility: ``internal-facing``.
    """

    name = models.CharField(max_length=255)
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

    @classmethod
    def get_or_create_by_name(cls, organization_id, name, created_by):
        """Find or create a Store by name within an org (case-insensitive).

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
