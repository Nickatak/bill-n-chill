from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Organization(models.Model):
    """Top-level company/workspace container."""

    display_name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=80, unique=True, null=True, blank=True)
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


class OrganizationMembership(models.Model):
    """Current user-to-organization membership with base role + optional capability flags."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        PM = "pm", "Project Manager"
        WORKER = "worker", "Worker"
        BOOKKEEPING = "bookkeeping", "Bookkeeping"
        VIEWER = "viewer", "Viewer"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        DISABLED = "disabled", "Disabled"

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="organization_membership",
    )
    role = models.CharField(max_length=32, choices=Role.choices, default=Role.OWNER)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.ACTIVE)
    capability_flags_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["organization_id", "user_id"]

    def __str__(self) -> str:
        return f"{self.user_id} -> {self.organization_id} ({self.role})"
