from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


class Customer(models.Model):
    """Client/owner account that owns one or more projects.

    Workflow role:
    - Canonical contact-representation object used by the Contacts management page.
    - Usually created/reused during lead conversion.
    - Serves as the customer anchor for projects and owner invoices.

    Current policy:
    - Customer records are user-scoped via `created_by` in current implementation.
    - `billing_address` is billing-only and intentionally separate from
      project-level `site_address`/service location data.
    - Deduplication/reuse behavior is handled by intake conversion logic, not by
      a hard unique constraint on this model.
    - Lifecycle control: `user-managed`.
    - Visibility: `internal-facing`.
    """

    display_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    billing_address = models.CharField(max_length=255, blank=True)
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
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return self.display_name
