"""Tests for the forgot-password / reset-password flow."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from core.models import (
    EmailRecord,
    EmailVerificationToken,
    Organization,
    OrganizationMembership,
    PasswordResetToken,
)

User = get_user_model()


def _bootstrap_user(email="owner@test.com", password="secret123", is_active=True):
    """Create a user with org + membership for auth payload generation."""
    user = User.objects.create_user(
        username=email, email=email, password=password, is_active=is_active,
    )
    org = Organization.objects.create(display_name="TestOrg", created_by=user)
    OrganizationMembership.objects.create(
        organization=org, user=user, role="owner",
        status=OrganizationMembership.Status.ACTIVE,
    )
    return user


# ---------------------------------------------------------------------------
# PasswordResetToken model tests
# ---------------------------------------------------------------------------


class PasswordResetTokenModelTests(TestCase):
    def setUp(self):
        self.user = _bootstrap_user()

    def test_token_auto_generated_on_save(self):
        token_obj = PasswordResetToken(user=self.user, email=self.user.email)
        token_obj.save()
        self.assertTrue(len(token_obj.token) >= 32)

    def test_expiry_auto_set_to_1_hour(self):
        before = timezone.now()
        token_obj = PasswordResetToken(user=self.user, email=self.user.email)
        token_obj.save()
        after = timezone.now()
        self.assertGreaterEqual(token_obj.expires_at, before + timedelta(hours=1) - timedelta(seconds=1))
        self.assertLessEqual(token_obj.expires_at, after + timedelta(hours=1) + timedelta(seconds=1))

    def test_lookup_valid_success(self):
        token_obj = PasswordResetToken(user=self.user, email=self.user.email)
        token_obj.save()
        found, error = PasswordResetToken.lookup_valid(token_obj.token)
        self.assertIsNotNone(found)
        self.assertIsNone(error)

    def test_lookup_valid_not_found(self):
        found, error = PasswordResetToken.lookup_valid("nonexistent")
        self.assertIsNone(found)
        self.assertEqual(error, "not_found")

    def test_lookup_valid_consumed(self):
        token_obj = PasswordResetToken(user=self.user, email=self.user.email)
        token_obj.save()
        token_obj.consumed_at = timezone.now()
        token_obj.save(update_fields=["consumed_at"])
        found, error = PasswordResetToken.lookup_valid(token_obj.token)
        self.assertIsNone(found)
        self.assertEqual(error, "consumed")

    def test_lookup_valid_expired(self):
        token_obj = PasswordResetToken(user=self.user, email=self.user.email)
        token_obj.save()
        token_obj.expires_at = timezone.now() - timedelta(seconds=1)
        token_obj.save(update_fields=["expires_at"])
        found, error = PasswordResetToken.lookup_valid(token_obj.token)
        self.assertIsNone(found)
        self.assertEqual(error, "expired")


# ---------------------------------------------------------------------------
# Forgot password endpoint tests
# ---------------------------------------------------------------------------


class ForgotPasswordTests(TestCase):
    def setUp(self):
        self.user = _bootstrap_user()

    def test_returns_200_for_valid_email(self):
        response = self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "owner@test.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("message", response.json()["data"])

    def test_creates_password_reset_token(self):
        self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "owner@test.com"},
            content_type="application/json",
        )
        self.assertTrue(PasswordResetToken.objects.filter(user=self.user).exists())

    def test_sends_password_reset_email(self):
        self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "owner@test.com"},
            content_type="application/json",
        )
        self.assertTrue(
            EmailRecord.objects.filter(
                recipient_email="owner@test.com",
                email_type=EmailRecord.EmailType.PASSWORD_RESET,
            ).exists()
        )

    def test_anti_enumeration_nonexistent_email(self):
        response = self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "nobody@test.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("message", response.json()["data"])

    def test_unverified_user_gets_verification_email(self):
        """Unverified users get a verification email instead of a password reset."""
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        response = self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "owner@test.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(PasswordResetToken.objects.filter(user=self.user).exists())
        self.assertTrue(EmailVerificationToken.objects.filter(user=self.user).exists())
        self.assertTrue(
            EmailRecord.objects.filter(
                recipient_email="owner@test.com",
                email_type=EmailRecord.EmailType.VERIFICATION,
            ).exists()
        )

    def test_rate_limited(self):
        self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "owner@test.com"},
            content_type="application/json",
        )
        response = self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "owner@test.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "rate_limited")

    def test_missing_email_returns_400(self):
        response = self.client.post(
            "/api/v1/auth/forgot-password/",
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_deletes_old_unconsumed_tokens(self):
        old = PasswordResetToken(user=self.user, email=self.user.email)
        old.save()
        old.created_at = timezone.now() - timedelta(seconds=120)
        PasswordResetToken.objects.filter(pk=old.pk).update(created_at=old.created_at)

        self.client.post(
            "/api/v1/auth/forgot-password/",
            data={"email": "owner@test.com"},
            content_type="application/json",
        )
        self.assertEqual(PasswordResetToken.objects.filter(user=self.user, consumed_at__isnull=True).count(), 1)
        self.assertFalse(PasswordResetToken.objects.filter(pk=old.pk).exists())


# ---------------------------------------------------------------------------
# Reset password endpoint tests
# ---------------------------------------------------------------------------


class ResetPasswordTests(TestCase):
    def setUp(self):
        self.user = _bootstrap_user()
        self.token_obj = PasswordResetToken(user=self.user, email=self.user.email)
        self.token_obj.save()

    def test_reset_valid_token(self):
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token, "new_password": "newpass123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertIn("token", payload)
        self.assertIn("user", payload)

    def test_password_actually_changed(self):
        self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token, "new_password": "newpass123"},
            content_type="application/json",
        )
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("newpass123"))

    def test_token_consumed_after_reset(self):
        self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token, "new_password": "newpass123"},
            content_type="application/json",
        )
        self.token_obj.refresh_from_db()
        self.assertIsNotNone(self.token_obj.consumed_at)

    def test_consumed_token_returns_410(self):
        self.token_obj.consumed_at = timezone.now()
        self.token_obj.save(update_fields=["consumed_at"])
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token, "new_password": "newpass123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_expired_token_returns_410(self):
        self.token_obj.expires_at = timezone.now() - timedelta(seconds=1)
        self.token_obj.save(update_fields=["expires_at"])
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token, "new_password": "newpass123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_invalid_token_returns_404(self):
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": "bogus", "new_password": "newpass123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_missing_token_returns_400(self):
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"new_password": "newpass123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_password_returns_400(self):
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_short_password_returns_400(self):
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token, "new_password": "short"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_auto_login_returns_auth_payload(self):
        response = self.client.post(
            "/api/v1/auth/reset-password/",
            data={"token": self.token_obj.token, "new_password": "newpass123"},
            content_type="application/json",
        )
        payload = response.json()["data"]
        self.assertEqual(payload["user"]["email"], "owner@test.com")
        self.assertIn("organization", payload)
        self.assertIn("capabilities", payload)


# ---------------------------------------------------------------------------
# Registration duplicate handler tests (updated behavior)
# ---------------------------------------------------------------------------


class RegisterDuplicateEmailTests(TestCase):
    def test_verified_user_gets_password_reset_email(self):
        """Re-registering with a verified user's email sends a password reset."""
        _bootstrap_user(email="verified@test.com")
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "verified@test.com", "password": "anything123"},
            content_type="application/json",
        )
        self.assertTrue(PasswordResetToken.objects.filter(email="verified@test.com").exists())
        self.assertTrue(
            EmailRecord.objects.filter(
                recipient_email="verified@test.com",
                email_type=EmailRecord.EmailType.PASSWORD_RESET,
            ).exists()
        )

    def test_unverified_user_gets_verification_resend(self):
        """Re-registering with an unverified user's email re-sends verification."""
        _bootstrap_user(email="unverified@test.com", is_active=False)
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "unverified@test.com", "password": "anything123"},
            content_type="application/json",
        )
        self.assertTrue(EmailVerificationToken.objects.filter(email="unverified@test.com").exists())
        self.assertTrue(
            EmailRecord.objects.filter(
                recipient_email="unverified@test.com",
                email_type=EmailRecord.EmailType.VERIFICATION,
            ).exists()
        )

    def test_duplicate_registration_respects_rate_limit(self):
        """Re-registration email sending respects the 60s rate limit."""
        user = _bootstrap_user(email="verified@test.com")
        # First attempt sends email
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "verified@test.com", "password": "anything123"},
            content_type="application/json",
        )
        count_after_first = EmailRecord.objects.filter(
            recipient_email="verified@test.com",
            email_type=EmailRecord.EmailType.PASSWORD_RESET,
        ).count()
        # Second attempt within 60s should be rate-limited (no new email)
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "verified@test.com", "password": "anything123"},
            content_type="application/json",
        )
        count_after_second = EmailRecord.objects.filter(
            recipient_email="verified@test.com",
            email_type=EmailRecord.EmailType.PASSWORD_RESET,
        ).count()
        self.assertEqual(count_after_first, count_after_second)

    def test_response_still_anti_enumeration(self):
        """Duplicate registration still returns same 200 regardless."""
        _bootstrap_user(email="existing@test.com")
        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "existing@test.com", "password": "anything123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("Check your email", response.json()["data"]["message"])
