"""OrganizationMembership model — user-to-org binding with RBAC role and capability flags."""

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class OrganizationMembership(models.Model):
    """Current user-to-organization membership.

    Workflow role:
    - Primary source of effective RBAC role (preferred over legacy Django groups).
    - Stores base role + optional capability flags for additive permissions.
    - Used by login/register/me flows to ensure every active user has org context.

    Current policy:
    - One active membership per user (enforced by `OneToOneField` on `user`).
      A user can only be actively associated with one org at a time.
    - Future multi-org support would require relaxing that constraint and adding active-org selection.
    - Lifecycle control: `system-managed` bootstrap with user/admin role maintenance.
    - Visibility: `internal-facing`.
    """

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        PM = "pm", "Project Manager"
        WORKER = "worker", "Worker"
        BOOKKEEPING = "bookkeeping", "Bookkeeping"
        VIEWER = "viewer", "Viewer"

    # Legacy/base role field used by current endpoint role gates.
    # This remains in place while permission-key authorization is introduced incrementally.
    # TODO(long-horizon): Remove this legacy role field after all models/endpoints are
    # gated by permission-key checks via role templates. This is expected to take a long
    # time and should only be done after full parity + migration validation.
    role = models.CharField(max_length=32, choices=Role.choices, default=Role.OWNER)

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
    # Optional role template pointer for composable, GitHub-style permission sets.
    # Not yet enforced by endpoint guards (model scaffold phase only).
    role_template = models.ForeignKey(
        "RoleTemplate",
        on_delete=models.SET_NULL,
        related_name="memberships",
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.ACTIVE)
    # Optional additive grants layered over the base role.
    capability_flags_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["organization_id", "user_id"]

    def build_snapshot(self) -> dict:
        """Build an immutable point-in-time snapshot dict for audit records."""
        return {
            "organization_membership": {
                "id": self.id,
                "organization_id": self.organization_id,
                "user_id": self.user_id,
                "role": self.role,
                "status": self.status,
                "role_template_id": self.role_template_id,
                "capability_flags_json": self.capability_flags_json or {},
                "created_at": self.created_at.isoformat() if self.created_at else None,
            }
        }

    def __str__(self) -> str:
        return f"{self.user_id} -> {self.organization_id} ({self.role})"
