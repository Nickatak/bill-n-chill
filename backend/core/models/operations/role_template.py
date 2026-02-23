from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class RoleTemplate(models.Model):
    """UNUSED (for now): Preset/custom role definition that composes multiple Permission entries.

    Workflow role:
    - Represents role presets (owner/manager/worker/accounting/viewer) and future custom roles.
    - Can be system-level (`organization` is null) or organization-local.
    - Bound to users indirectly via OrganizationMembership.role_template.

    Notes:
    - `slug` is the stable role identifier for API/UI wiring.
    - This model is introduced now for documentation/data-shape readiness;
      endpoint authorization will migrate to permission-key checks incrementally.
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
