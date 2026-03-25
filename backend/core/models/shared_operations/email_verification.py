"""Email verification models — token-based email ownership proof and audit trail."""

import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

from core.models.mixins import ImmutableModelMixin

User = get_user_model()

VERIFICATION_EXPIRY_HOURS = 24
PASSWORD_RESET_EXPIRY_HOURS = 1


class EmailVerificationToken(models.Model):
    """Time-limited token for verifying email ownership during registration.

    Mirrors the OrganizationInvite token pattern: URL-safe, unique,
    single-use, expires after 24 hours. Created during Flow A registration
    and consumed when the user clicks the verification link.

    Flow B (invite registration) skips verification — the invite token
    itself proves the email was expected.

    Verification status is tracked via ``User.is_active``: Flow A users
    start with ``is_active=False`` and are activated when the token is
    consumed. Legacy/seed users have ``is_active=True`` by default.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="email_verification_tokens",
    )
    email = models.EmailField()
    token = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        """Auto-generate token and expiry if not already set, then persist."""
        if not self.token:
            self.token = secrets.token_urlsafe(32)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=VERIFICATION_EXPIRY_HOURS)
        super().save(*args, **kwargs)

    @property
    def is_expired(self):
        """True if the token's expiry time has passed."""
        return timezone.now() > self.expires_at

    @property
    def is_consumed(self):
        """True if the token has already been used."""
        return self.consumed_at is not None

    @property
    def is_valid(self):
        """True if the token is neither expired nor consumed."""
        return not self.is_expired and not self.is_consumed

    @classmethod
    def lookup_valid(cls, token_str):
        """Fetch a verification token and validate it's still usable.

        Returns (token_obj, None) on success, or (None, error_code) where
        error_code is one of: "not_found", "consumed", "expired".
        """
        try:
            token_obj = cls.objects.select_related("user").get(token=token_str)
        except cls.DoesNotExist:
            return None, "not_found"
        if token_obj.is_consumed:
            return None, "consumed"
        if token_obj.is_expired:
            return None, "expired"
        return token_obj, None

    def __str__(self):
        return f"VerificationToken {self.email} ({self.token[:8]}...)"


class PasswordResetToken(models.Model):
    """Time-limited token for password reset requests.

    Same pattern as EmailVerificationToken but with a shorter expiry (1 hour)
    since password resets are more security-sensitive. Created by the
    forgot-password endpoint and consumed when the user submits a new password.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="password_reset_tokens",
    )
    email = models.EmailField()
    token = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        """Auto-generate token and expiry if not already set, then persist."""
        if not self.token:
            self.token = secrets.token_urlsafe(32)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=PASSWORD_RESET_EXPIRY_HOURS)
        super().save(*args, **kwargs)

    @property
    def is_expired(self):
        """True if the token's expiry time has passed."""
        return timezone.now() > self.expires_at

    @property
    def is_consumed(self):
        """True if the token has already been used."""
        return self.consumed_at is not None

    @property
    def is_valid(self):
        """True if the token is neither expired nor consumed."""
        return not self.is_expired and not self.is_consumed

    @classmethod
    def lookup_valid(cls, token_str):
        """Fetch a password reset token and validate it's still usable.

        Returns (token_obj, None) on success, or (None, error_code) where
        error_code is one of: "not_found", "consumed", "expired".
        """
        try:
            token_obj = cls.objects.select_related("user").get(token=token_str)
        except cls.DoesNotExist:
            return None, "not_found"
        if token_obj.is_consumed:
            return None, "consumed"
        if token_obj.is_expired:
            return None, "expired"
        return token_obj, None

    def __str__(self):
        return f"PasswordResetToken {self.email} ({self.token[:8]}...)"


class EmailRecord(ImmutableModelMixin):
    """Immutable audit log for all transactional emails sent by the system.

    Append-only — records cannot be updated or deleted. Each row captures
    the full email content and delivery status for auditability.
    """

    _immutable_label = "Email records"

    class EmailType(models.TextChoices):
        VERIFICATION = "verification", "Verification"
        PASSWORD_RESET = "password_reset", "Password Reset"
        OTP = "otp", "OTP"
        DOCUMENT_SENT = "document_sent", "Document Sent"
        DOCUMENT_DECISION = "document_decision", "Document Decision"

    recipient_email = models.EmailField()
    email_type = models.CharField(max_length=32, choices=EmailType.choices)
    subject = models.CharField(max_length=255)
    body_text = models.TextField()
    sent_by_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sent_email_records",
    )
    metadata_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @classmethod
    def record(cls, *, recipient_email, email_type, subject, body_text, sent_by_user=None, metadata=None):
        """Append an immutable email audit record."""
        return cls.objects.create(
            recipient_email=recipient_email,
            email_type=email_type,
            subject=subject,
            body_text=body_text,
            sent_by_user=sent_by_user,
            metadata_json=metadata or {},
        )

    def __str__(self):
        return f"EmailRecord [{self.email_type}] -> {self.recipient_email}"
