from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Organization(models.Model):
    """Top-level company/workspace container.

    Workflow role:
    - First-class tenant boundary for collaboration and RBAC.
    - Created automatically during auth bootstrap if a user has no active membership.
    - Currently one user maps to one primary org via OrganizationMembership one-to-one.

    Notes:
    - "Auth bootstrap" means auth-time minimum operational dependency setup
      (not only registration-time creation; triggered during login for legacy users).
    - login/me can self-heal legacy or inconsistent user records by provisioning missing org membership.
    - `display_name` is human-facing and non-authoritative identity.
    - Lifecycle control: `system-managed` bootstrap + admin-managed tenant metadata.
    - Visibility: `internal-facing` tenancy boundary object.
    """

    display_name = models.CharField(max_length=255)
    logo_url = models.URLField(blank=True, default="")
    help_email = models.EmailField(blank=True, default="")
    billing_address = models.TextField(blank=True, default="")
    default_invoice_due_delta = models.PositiveSmallIntegerField(default=30)
    default_estimate_valid_delta = models.PositiveSmallIntegerField(default=30)
    invoice_terms_and_conditions = models.TextField(blank=True, default="")
    estimate_terms_and_conditions = models.TextField(blank=True, default="")
    change_order_terms_and_conditions = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="created_organizations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def build_snapshot(self) -> dict:
        """Build an immutable point-in-time snapshot dict for audit records."""
        return {
            "organization": {
                "id": self.id,
                "display_name": self.display_name,
                "logo_url": self.logo_url,
                "help_email": self.help_email,
                "billing_address": self.billing_address,
                "default_invoice_due_delta": self.default_invoice_due_delta,
                "default_estimate_valid_delta": self.default_estimate_valid_delta,
                "invoice_terms_and_conditions": self.invoice_terms_and_conditions,
                "estimate_terms_and_conditions": self.estimate_terms_and_conditions,
                "change_order_terms_and_conditions": self.change_order_terms_and_conditions,
                "created_by_id": self.created_by_id,
                "created_at": self.created_at.isoformat() if self.created_at else None,
            }
        }

    @classmethod
    def derive_name(cls, user) -> str:
        """Derive a human-friendly default organization name from a user's email or username."""
        seed = (user.email or user.username or f"user-{user.id}").split("@")[0].strip()
        humanized = seed.replace(".", " ").replace("_", " ").replace("-", " ").strip().title()
        return f"{humanized or 'New'} Organization"

    def __str__(self) -> str:
        return self.display_name
