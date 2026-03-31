"""Document access session — OTP-verified sessions for public document decisions."""

import secrets
from datetime import timedelta

from django.db import models
from django.utils import timezone

OTP_EXPIRY_MINUTES = 10
SESSION_EXPIRY_MINUTES = 60
MAX_VERIFY_ATTEMPTS = 10


class DocumentAccessSession(models.Model):
    """Tracks OTP verification and session state for public document decisions.

    When a customer wants to approve/reject a public document, they must first
    verify their identity via a 6-digit OTP sent to the customer email on file.
    After verification, a session token is activated that authorizes the signing
    ceremony and decision submission.

    Mirrors the EmailVerificationToken pattern: mutable (verified_at updates),
    auto-generated codes/tokens, expiry-based lifecycle.
    """

    class DocumentType(models.TextChoices):
        QUOTE = "quote", "Quote"
        CHANGE_ORDER = "change_order", "Change Order"
        INVOICE = "invoice", "Invoice"

    document_type = models.CharField(max_length=20, choices=DocumentType.choices)
    document_id = models.PositiveIntegerField()
    public_token = models.CharField(max_length=24, db_index=True)
    recipient_email = models.EmailField()
    code = models.CharField(max_length=6)
    session_token = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    session_expires_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        """Auto-generate OTP code, session token, and expiry on initial save."""
        if not self.code:
            self.code = self._generate_unique_code()
        if not self.session_token:
            self.session_token = secrets.token_urlsafe(32)
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(minutes=OTP_EXPIRY_MINUTES)
        super().save(*args, **kwargs)

    def _generate_unique_code(self):
        """Generate a 6-digit code unique among unexpired sessions for this document."""
        for _ in range(100):
            candidate = "".join(secrets.choice("0123456789") for _ in range(6))
            collision = (
                type(self)
                .objects.filter(
                    public_token=self.public_token,
                    code=candidate,
                    expires_at__gt=timezone.now(),
                    verified_at__isnull=True,
                )
                .exists()
            )
            if not collision:
                return candidate
        # Extremely unlikely fallback — 10^6 codes, collision-checked 100 times.
        return "".join(secrets.choice("0123456789") for _ in range(6))

    @property
    def is_expired(self):
        """True if the OTP code's expiry time has passed."""
        return timezone.now() > self.expires_at

    @property
    def is_verified(self):
        """True if the OTP has been successfully verified."""
        return self.verified_at is not None

    @property
    def is_session_valid(self):
        """True if the session is verified and hasn't expired."""
        if not self.is_verified or not self.session_expires_at:
            return False
        return timezone.now() <= self.session_expires_at

    @classmethod
    def lookup_for_verification(cls, public_token, code):
        """Find a session by public_token + code and validate it's verifiable.

        Returns (session, None) on success, or (None, error_code) where
        error_code is one of: "not_found", "expired", "already_verified",
        "max_attempts".
        """
        try:
            session = cls.objects.get(
                public_token=public_token,
                code=code,
                verified_at__isnull=True,
            )
        except cls.DoesNotExist:
            # Wrong code — increment failed_attempts on the latest unverified session.
            cls._record_failed_attempt(public_token)
            # Check if it was already verified (separate error code).
            if cls.objects.filter(public_token=public_token, code=code, verified_at__isnull=False).exists():
                return None, "already_verified"
            return None, "not_found"
        if session.is_expired:
            return None, "expired"
        if session.failed_attempts >= MAX_VERIFY_ATTEMPTS:
            return None, "max_attempts"
        return session, None

    @classmethod
    def _record_failed_attempt(cls, public_token):
        """Increment failed_attempts on the latest unverified session for this token.

        When MAX_VERIFY_ATTEMPTS is reached, the session is effectively expired —
        lookup_for_verification will reject further attempts.
        """
        latest = (
            cls.objects.filter(
                public_token=public_token,
                verified_at__isnull=True,
            )
            .order_by("-created_at")
            .first()
        )
        if latest and latest.failed_attempts < MAX_VERIFY_ATTEMPTS:
            latest.failed_attempts += 1
            latest.save(update_fields=["failed_attempts"])

    @classmethod
    def lookup_valid_session(cls, public_token, session_token):
        """Find a verified session by public_token + session_token.

        Returns (session, None) on success, or (None, error_code) where
        error_code is one of: "not_found", "expired".
        """
        try:
            session = cls.objects.get(
                public_token=public_token,
                session_token=session_token,
                verified_at__isnull=False,
            )
        except cls.DoesNotExist:
            return None, "not_found"
        if not session.is_session_valid:
            return None, "expired"
        return session, None

    def __str__(self):
        status = "verified" if self.is_verified else ("expired" if self.is_expired else "pending")
        return f"DocumentAccessSession {self.document_type}:{self.document_id} ({status})"
