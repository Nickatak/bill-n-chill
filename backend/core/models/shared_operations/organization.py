from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Organization(models.Model):
    """Top-level company/workspace container.

    Workflow role:
    - First-class tenant boundary (SaaS term for isolated org/workspace data scope) for collaboration and RBAC.
    - Created automatically during auth bootstrap if a user has no active membership.
    - Currently one user maps to one primary org via OrganizationMembership one-to-one.

    Notes:
    - "Auth bootstrap" here means auth-time minimum operational dependency setup
      (not only registration-time creation; this can be triggered during login
      for an old DB user from before the Org model existed).
    - Implication: login/me can self-heal legacy or inconsistent user records by provisioning missing org membership.
    - `display_name` is human-facing and non-authoritative identity.
    - `slug` is optional URL alias/branding and should not be treated as security identity.
    - Lifecycle control: `system-managed` bootstrap + admin-managed tenant metadata.
    - Visibility: `internal-facing` tenancy boundary object.
    """

    display_name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=80, unique=True, null=True, blank=True)
    logo_url = models.URLField(blank=True, default="")
    invoice_sender_name = models.CharField(max_length=255, blank=True, default="")
    invoice_sender_email = models.EmailField(blank=True, default="")
    help_email = models.EmailField(blank=True, default="")
    invoice_sender_address = models.TextField(blank=True, default="")
    invoice_default_due_days = models.PositiveSmallIntegerField(default=30)
    estimate_validation_delta_days = models.PositiveSmallIntegerField(default=30)
    invoice_default_terms = models.TextField(blank=True, default="")
    estimate_default_terms = models.TextField(blank=True, default="")
    change_order_default_reason = models.TextField(blank=True, default="")
    change_order_default_terms = models.TextField(blank=True, default="")
    invoice_default_footer = models.TextField(blank=True, default="")
    invoice_default_notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="created_organizations",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.display_name
