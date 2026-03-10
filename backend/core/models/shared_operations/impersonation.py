"""Impersonation token model — superuser-only identity assumption for support."""

import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

User = get_user_model()

IMPERSONATION_EXPIRY_HOURS = 8


class ImpersonationToken(models.Model):
    """Token that lets a superuser make requests as another user.

    Separate from the standard DRF Token to avoid touching the existing
    auth system. The custom ``ImpersonationTokenAuthentication`` backend
    checks this table first; if no match, normal TokenAuthentication
    takes over.

    Lifecycle:
    - Created by ``POST /admin/impersonate/`` (superuser only).
    - Deleted by ``POST /admin/impersonate/exit/`` or on expiry.
    - ``user`` is the target (who you see the app as).
    - ``impersonated_by`` is the real actor (the superuser).
    """

    key = models.CharField(max_length=64, unique=True, db_index=True)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="impersonation_tokens",
        help_text="The user being impersonated (target).",
    )
    impersonated_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="impersonation_sessions",
        help_text="The superuser who initiated impersonation.",
    )
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        """Auto-generate key and expiry if not already set."""
        if not self.key:
            self.key = secrets.token_urlsafe(32)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=IMPERSONATION_EXPIRY_HOURS)
        super().save(*args, **kwargs)

    @property
    def is_expired(self):
        """True if the token's expiry time has passed."""
        return timezone.now() > self.expires_at

    def __str__(self):
        return f"Impersonation: {self.impersonated_by} → {self.user} ({self.key[:8]}...)"
