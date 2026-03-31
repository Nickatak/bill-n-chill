"""Organization model — top-level tenant container for multi-user workspaces."""

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
    logo = models.ImageField(upload_to="logos/", blank=True, default="")
    help_email = models.EmailField(blank=True, default="")
    billing_street_1 = models.CharField(max_length=255, blank=True, default="")
    billing_street_2 = models.CharField(max_length=255, blank=True, default="")
    billing_city = models.CharField(max_length=100, blank=True, default="")
    billing_state = models.CharField(max_length=50, blank=True, default="")
    billing_zip = models.CharField(max_length=20, blank=True, default="")
    phone_number = models.CharField(max_length=50, blank=True, default="")
    website_url = models.URLField(blank=True, default="")
    license_number = models.CharField(max_length=100, blank=True, default="")
    tax_id = models.CharField(max_length=50, blank=True, default="")
    default_invoice_due_delta = models.PositiveSmallIntegerField(default=30)
    default_quote_valid_delta = models.PositiveSmallIntegerField(default=30)
    invoice_terms_and_conditions = models.TextField(blank=True, default="")
    quote_terms_and_conditions = models.TextField(blank=True, default="")
    change_order_terms_and_conditions = models.TextField(blank=True, default="")
    onboarding_completed = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="created_organizations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    @property
    def formatted_billing_address(self) -> str:
        """Format structured address fields into a multi-line display string."""
        lines = []
        if self.billing_street_1:
            lines.append(self.billing_street_1.strip())
        if self.billing_street_2:
            lines.append(self.billing_street_2.strip())
        city_state_zip = []
        if self.billing_city:
            city_state_zip.append(self.billing_city.strip())
        if self.billing_state:
            if city_state_zip:
                city_state_zip[-1] += ","
            city_state_zip.append(self.billing_state.strip())
        if self.billing_zip:
            city_state_zip.append(self.billing_zip.strip())
        if city_state_zip:
            lines.append(" ".join(city_state_zip))
        return "\n".join(lines)

    def build_snapshot(self) -> dict:
        """Build an immutable point-in-time snapshot dict for audit records."""
        return {
            "organization": {
                "id": self.id,
                "display_name": self.display_name,
                "logo_url": self.logo.url if self.logo else "",
                "help_email": self.help_email,
                "billing_address": self.formatted_billing_address,
                "billing_street_1": self.billing_street_1,
                "billing_street_2": self.billing_street_2,
                "billing_city": self.billing_city,
                "billing_state": self.billing_state,
                "billing_zip": self.billing_zip,
                "phone_number": self.phone_number,
                "website_url": self.website_url,
                "license_number": self.license_number,
                "tax_id": self.tax_id,
                "default_invoice_due_delta": self.default_invoice_due_delta,
                "default_quote_valid_delta": self.default_quote_valid_delta,
                "invoice_terms_and_conditions": self.invoice_terms_and_conditions,
                "quote_terms_and_conditions": self.quote_terms_and_conditions,
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
