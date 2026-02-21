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
    """

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
    """Current user-to-organization membership.

    Workflow role:
    - Primary source of effective RBAC role (preferred over legacy Django groups).
    - Stores base role + optional capability flags for additive permissions.
    - Used by login/register/me flows to ensure every active user has org context.

    Current policy:
    - One active membership per user (enforced by `OneToOneField` on `user`).
      A user can only be actively associated with one org at a time.
    - Future multi-org support would require relaxing that constraint and adding active-org selection.
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

    def __str__(self) -> str:
        return f"{self.user_id} -> {self.organization_id} ({self.role})"


class Permission(models.Model):
    """UNUSED (for now): Atomic capability key.

    Workflow role:
    - Defines one granular action that can be granted by a role template.
    - Intended to become the stable authorization vocabulary for endpoint guards.
    - Permission gates will be added as we iterate, but keys are intentionally not
      used for runtime authorization until all models are gated and parity tests pass.

    Naming convention:
    - Use dotted keys like `invoices.write`, `change_orders.approve`, `accounting.export`.
    - Keys should be globally unique and semantically stable over time.
    """

    key = models.CharField(max_length=120, unique=True)
    category = models.CharField(max_length=64, blank=True, default="")
    description = models.CharField(max_length=255, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self) -> str:
        return self.key


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
