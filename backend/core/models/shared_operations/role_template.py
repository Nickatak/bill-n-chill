from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class RoleTemplate(models.Model):
    """Preset/custom role definition with capability flags.

    Workflow role:
    - Represents role presets (owner/pm/worker/bookkeeping/viewer) and future custom roles.
    - Can be system-level (`organization` is null) or organization-local.
    - Bound to users indirectly via OrganizationMembership.role_template.
    - `capability_flags_json` stores the permission matrix as {resource: [actions]}.

    Notes:
    - `slug` is the stable role identifier for API/UI wiring.
    - System templates (is_system=True, organization=None) are seeded via migration.
    """

    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=80, unique=True)
    organization = models.ForeignKey(
        "Organization",
        on_delete=models.CASCADE,
        related_name="role_templates",
        null=True,
        blank=True,
    )
    is_system = models.BooleanField(default=False)
    capability_flags_json = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="created_role_templates",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self) -> str:
        return self.slug
