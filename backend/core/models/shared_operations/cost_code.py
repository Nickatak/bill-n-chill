"""CostCode model — reusable financial classification for estimating and billing line items."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class CostCode(models.Model):
    """Reusable financial classification used across estimating/budgeting/billing line items.

    Business workflow:
    - Managed per company/user as a shared catalog.
    - Applied to quote lines, invoice lines, and vendor bill lines for rollups.

    Current policy:
    - Cost codes are scoped by `organization` and unique per organization catalog.
    - Code values are immutable identifiers in practice; renames should keep semantic continuity.
    - `is_active=False` deprecates selection in UI flows without deleting historical references.
    - Cost codes are non-deletable by policy to preserve historical financial traceability.
    - Lifecycle control: `user-managed` catalog with constrained mutation (`code` immutable, no delete).
    - Visibility: `internal-facing`.
    """

    class CostCodeQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError(
                "Cost codes are non-deletable. Set is_active=false to retire a code."
            )

    objects = CostCodeQuerySet.as_manager()

    code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    taxable = models.BooleanField(default=True)
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="cost_codes",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="cost_codes",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"],
                name="unique_cost_code_per_organization",
            ),
        ]

    @classmethod
    def seed_defaults(cls, *, organization, created_by) -> int:
        """Seed the default cost codes for an organization.

        Returns the number of cost codes actually created (skips duplicates).
        """
        from core.utils.cost_code_defaults import DEFAULT_COST_CODE_ROWS

        created_count = 0
        for code, name in DEFAULT_COST_CODE_ROWS:
            _row, created = cls.objects.get_or_create(
                organization=organization,
                code=code,
                defaults={
                    "name": name,
                    "is_active": True,
                    "created_by": created_by,
                },
            )
            if created:
                created_count += 1
        return created_count

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"

    def delete(self, using=None, keep_parents=False):
        """Raise ValidationError — cost codes are non-deletable by policy."""
        raise ValidationError(
            "Cost codes are non-deletable. Set is_active=false to retire a code."
        )
