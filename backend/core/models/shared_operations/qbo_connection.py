"""QuickBooks Online OAuth connection — per-organization token storage.

Stores encrypted OAuth2 tokens for the QBO push sync integration. Each
organization can have at most one active QBO connection. Tokens are
encrypted at rest using Fernet derived from Django's SECRET_KEY.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.utils.encryption import decrypt_token, encrypt_token


class QBOConnection(models.Model):
    """Per-org QuickBooks Online OAuth2 connection."""

    organization = models.OneToOneField(
        "Organization",
        on_delete=models.CASCADE,
        related_name="qbo_connection",
    )
    realm_id = models.CharField(
        max_length=64,
        help_text="QBO company ID (realmId from OAuth callback).",
    )

    # Encrypted OAuth tokens — use the property accessors, not the raw fields.
    _access_token = models.TextField(
        db_column="access_token",
        help_text="Fernet-encrypted OAuth2 access token.",
    )
    _refresh_token = models.TextField(
        db_column="refresh_token",
        help_text="Fernet-encrypted OAuth2 refresh token.",
    )

    access_token_expires_at = models.DateTimeField(
        help_text="When the current access token expires.",
    )
    refresh_token_expires_at = models.DateTimeField(
        help_text="When the refresh token expires (~100 days from issue).",
    )

    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    disconnected_at = models.DateTimeField(null=True, blank=True)

    connected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    class Meta:
        db_table = "core_qboconnection"
        verbose_name = "QBO Connection"
        verbose_name_plural = "QBO Connections"

    def __str__(self) -> str:
        status = "connected" if self.is_connected else "disconnected"
        return f"QBO {status} — org={self.organization_id} realm={self.realm_id}"

    # ── Token property accessors ──────────────────────────────────────────

    @property
    def access_token(self) -> str:
        """Decrypt and return the access token."""
        return decrypt_token(self._access_token)

    @access_token.setter
    def access_token(self, value: str) -> None:
        """Encrypt and store the access token."""
        self._access_token = encrypt_token(value)

    @property
    def refresh_token(self) -> str:
        """Decrypt and return the refresh token."""
        return decrypt_token(self._refresh_token)

    @refresh_token.setter
    def refresh_token(self, value: str) -> None:
        """Encrypt and store the refresh token."""
        self._refresh_token = encrypt_token(value)

    # ── Status helpers ────────────────────────────────────────────────────

    @property
    def is_connected(self) -> bool:
        """True if the connection has not been disconnected."""
        return self.disconnected_at is None

    @property
    def is_access_token_expired(self) -> bool:
        """True if the access token has expired (needs refresh)."""
        return timezone.now() >= self.access_token_expires_at

    @property
    def is_refresh_token_expired(self) -> bool:
        """True if the refresh token has expired (must re-authenticate)."""
        return timezone.now() >= self.refresh_token_expires_at

    def disconnect(self) -> None:
        """Mark this connection as disconnected and clear tokens."""
        self.disconnected_at = timezone.now()
        self._access_token = ""
        self._refresh_token = ""
        self.save(update_fields=[
            "_access_token",
            "_refresh_token",
            "disconnected_at",
            "updated_at",
        ])
