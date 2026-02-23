from django.db import models


class RoleTemplatePermission(models.Model):
    """UNUSED (for now): Composite mapping from RoleTemplate -> Permission.

    Workflow role:
    - Stores which permission keys are granted by a role template.
    - Enables additive capability composition without hardcoding all grants in endpoint logic.

    Design note:
    - `is_allowed` exists to support future explicit deny/override patterns.
      In the current scaffold phase, entries are expected to be allow-grants.
    """

    role_template = models.ForeignKey(
        "RoleTemplate",
        on_delete=models.CASCADE,
        related_name="permission_links",
    )
    permission = models.ForeignKey(
        "Permission",
        on_delete=models.CASCADE,
        related_name="role_links",
    )
    is_allowed = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["role_template_id", "permission_id"]
        unique_together = ("role_template", "permission")

    def __str__(self) -> str:
        return f"{self.role_template.slug} -> {self.permission.key} ({'allow' if self.is_allowed else 'deny'})"
