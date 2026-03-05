import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

from core.models.shared_operations.organization_membership import OrganizationMembership

User = get_user_model()

INVITE_EXPIRY_HOURS = 24


class OrganizationInvite(models.Model):
    """Time-limited invite token for joining an organization.

    Workflow role:
    - Created by owners/PMs to invite users to their org.
    - Token is URL-safe, unique, single-use, and expires after 24 hours.
    - Consumed during registration (Flow B) or org-switch (Flow C).

    Current policy:
    - One active (unconsumed, unexpired) invite per email per org.
    - Email-bound: only the invited email can use the token.
    - Visibility: `internal-facing` (created/listed by org members, consumed by invitees).
    """

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.CASCADE,
        related_name="invites",
    )
    email = models.EmailField()
    role_template = models.ForeignKey(
        "RoleTemplate",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    role = models.CharField(
        max_length=32,
        choices=OrganizationMembership.Role.choices,
        default=OrganizationMembership.Role.VIEWER,
    )
    token = models.CharField(max_length=64, unique=True, db_index=True)
    invited_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="sent_invites",
    )
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = secrets.token_urlsafe(32)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=INVITE_EXPIRY_HOURS)
        super().save(*args, **kwargs)

    @property
    def is_expired(self):
        return timezone.now() > self.expires_at

    @property
    def is_consumed(self):
        return self.consumed_at is not None

    @property
    def is_valid(self):
        return not self.is_expired and not self.is_consumed

    @classmethod
    def lookup_valid(cls, token_str):
        """Fetch an invite by token and validate it's still usable.

        Returns (invite, None) on success, or (None, error_code) where
        error_code is one of: "not_found", "consumed", "expired".
        """
        try:
            invite = cls.objects.select_related(
                "organization", "role_template"
            ).get(token=token_str)
        except cls.DoesNotExist:
            return None, "not_found"
        if invite.is_consumed:
            return None, "consumed"
        if invite.is_expired:
            return None, "expired"
        return invite, None

    def __str__(self):
        return f"Invite {self.email} -> {self.organization_id} ({self.token[:8]}...)"
