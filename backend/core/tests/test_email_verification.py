from datetime import timedelta
from django.core import mail
from django.core.exceptions import ValidationError
from django.utils import timezone
from core.tests.common import *


class EmailVerificationTokenModelTests(TestCase):
    """Model-level tests for EmailVerificationToken."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="verify@example.com",
            email="verify@example.com",
            password="secret123",
        )

    def test_token_auto_generated_on_save(self):
        token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        token_obj.save()
        self.assertTrue(token_obj.token)
        self.assertEqual(len(token_obj.token), 43)  # token_urlsafe(32) length

    def test_expiry_auto_set_to_24_hours(self):
        before = timezone.now()
        token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        token_obj.save()
        after = timezone.now()
        self.assertGreaterEqual(token_obj.expires_at, before + timedelta(hours=24))
        self.assertLessEqual(token_obj.expires_at, after + timedelta(hours=24))

    def test_lookup_valid_success(self):
        token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        token_obj.save()
        found, error = EmailVerificationToken.lookup_valid(token_obj.token)
        self.assertIsNotNone(found)
        self.assertIsNone(error)
        self.assertEqual(found.id, token_obj.id)

    def test_lookup_valid_not_found(self):
        found, error = EmailVerificationToken.lookup_valid("nonexistent-token")
        self.assertIsNone(found)
        self.assertEqual(error, "not_found")

    def test_lookup_valid_consumed(self):
        token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        token_obj.save()
        token_obj.consumed_at = timezone.now()
        token_obj.save(update_fields=["consumed_at"])
        found, error = EmailVerificationToken.lookup_valid(token_obj.token)
        self.assertIsNone(found)
        self.assertEqual(error, "consumed")

    def test_lookup_valid_expired(self):
        token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        token_obj.save()
        token_obj.expires_at = timezone.now() - timedelta(hours=1)
        token_obj.save(update_fields=["expires_at"])
        found, error = EmailVerificationToken.lookup_valid(token_obj.token)
        self.assertIsNone(found)
        self.assertEqual(error, "expired")


class EmailRecordModelTests(TestCase):
    """Model-level tests for EmailRecord (immutable audit log)."""

    def test_record_creation(self):
        record = EmailRecord.record(
            recipient_email="test@example.com",
            email_type=EmailRecord.EmailType.VERIFICATION,
            subject="Test",
            body_text="Test body",
        )
        self.assertEqual(record.recipient_email, "test@example.com")
        self.assertEqual(record.email_type, "verification")

    def test_record_immutability(self):
        record = EmailRecord.record(
            recipient_email="test@example.com",
            email_type=EmailRecord.EmailType.VERIFICATION,
            subject="Test",
            body_text="Test body",
        )
        record.subject = "Modified"
        with self.assertRaises(ValidationError):
            record.save()
        with self.assertRaises(ValidationError):
            record.delete()


class RegisterFlowAVerificationTests(TestCase):
    """Registration Flow A now returns 200 with message, creates verification token."""

    def test_register_returns_check_email_message(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "new@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("message", payload["data"])
        self.assertNotIn("token", payload["data"])

    def test_register_creates_inactive_user(self):
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "new@example.com", "password": "secret123"},
            content_type="application/json",
        )
        user = User.objects.get(email="new@example.com")
        self.assertFalse(user.is_active)

    def test_register_creates_verification_token(self):
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "new@example.com", "password": "secret123"},
            content_type="application/json",
        )
        user = User.objects.get(email="new@example.com")
        token_obj = EmailVerificationToken.objects.get(user=user)
        self.assertFalse(token_obj.is_consumed)
        self.assertFalse(token_obj.is_expired)

    def test_register_sends_verification_email(self):
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "new@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["new@example.com"])
        self.assertIn("verify", mail.outbox[0].subject.lower())

    def test_register_creates_email_audit_record(self):
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "new@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertTrue(
            EmailRecord.objects.filter(
                recipient_email="new@example.com",
                email_type=EmailRecord.EmailType.VERIFICATION,
            ).exists()
        )

    def test_register_duplicate_email_same_response(self):
        User.objects.create_user(
            username="existing@example.com",
            email="existing@example.com",
            password="secret123",
        )
        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "existing@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("message", response.json()["data"])

    def test_register_duplicate_does_not_create_token(self):
        User.objects.create_user(
            username="existing@example.com",
            email="existing@example.com",
            password="secret123",
        )
        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "existing@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertFalse(EmailVerificationToken.objects.filter(email="existing@example.com").exists())

    def test_flow_b_invite_unchanged(self):
        """Flow B (invite registration) still returns 201 with auth token."""
        owner = User.objects.create_user(
            username="owner@example.com",
            email="owner@example.com",
            password="secret123",
        )
        org = Organization.objects.create(display_name="TestOrg", created_by=owner)
        OrganizationMembership.objects.create(
            organization=org,
            user=owner,
            role=OrganizationMembership.Role.OWNER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        role_template = RoleTemplate.objects.filter(slug="pm").first()
        invite = OrganizationInvite.objects.create(
            organization=org,
            email="invited@example.com",
            role=OrganizationMembership.Role.PM,
            role_template=role_template,
            invited_by=owner,
        )
        response = self.client.post(
            "/api/v1/auth/register/",
            data={
                "email": "invited@example.com",
                "password": "secret123",
                "invite_token": invite.token,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertIn("token", response.json()["data"])


class VerifyEmailTests(TestCase):
    """Tests for the verify-email endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="unverified@example.com",
            email="unverified@example.com",
            password="secret123",
            is_active=False,
        )
        self.token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        self.token_obj.save()

    def test_verify_valid_token(self):
        response = self.client.post(
            "/api/v1/auth/verify-email/",
            data={"token": self.token_obj.token},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("token", payload["data"])
        self.assertEqual(payload["data"]["user"]["email"], "unverified@example.com")

        self.token_obj.refresh_from_db()
        self.assertIsNotNone(self.token_obj.consumed_at)

        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_verify_expired_token(self):
        self.token_obj.expires_at = timezone.now() - timedelta(hours=1)
        self.token_obj.save(update_fields=["expires_at"])
        response = self.client.post(
            "/api/v1/auth/verify-email/",
            data={"token": self.token_obj.token},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_verify_consumed_token(self):
        self.token_obj.consumed_at = timezone.now()
        self.token_obj.save(update_fields=["consumed_at"])
        response = self.client.post(
            "/api/v1/auth/verify-email/",
            data={"token": self.token_obj.token},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_verify_not_found(self):
        response = self.client.post(
            "/api/v1/auth/verify-email/",
            data={"token": "bogus"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_verify_missing_token_field(self):
        response = self.client.post(
            "/api/v1/auth/verify-email/",
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class ResendVerificationTests(TestCase):
    """Tests for the resend-verification endpoint."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="unverified@example.com",
            email="unverified@example.com",
            password="secret123",
            is_active=False,
        )
        self.token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        self.token_obj.save()
        # Backdate so rate limit doesn't fire.
        EmailVerificationToken.objects.filter(pk=self.token_obj.pk).update(
            created_at=timezone.now() - timedelta(minutes=5),
        )

    def test_resend_deletes_old_token_and_creates_new(self):
        response = self.client.post(
            "/api/v1/auth/resend-verification/",
            data={"email": "unverified@example.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        # Old unconsumed token deleted, new one created.
        self.assertEqual(EmailVerificationToken.objects.filter(user=self.user).count(), 1)
        new_token = EmailVerificationToken.objects.get(user=self.user)
        self.assertNotEqual(new_token.pk, self.token_obj.pk)
        self.assertEqual(len(mail.outbox), 1)

    def test_resend_rate_limited(self):
        # Reset created_at to now (within 60s).
        EmailVerificationToken.objects.filter(pk=self.token_obj.pk).update(
            created_at=timezone.now(),
        )
        response = self.client.post(
            "/api/v1/auth/resend-verification/",
            data={"email": "unverified@example.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)
        message = response.json()["error"]["message"]
        self.assertRegex(message, r"Please wait \d+ seconds before requesting another email\.")

    def test_resend_nonexistent_email_returns_200(self):
        response = self.client.post(
            "/api/v1/auth/resend-verification/",
            data={"email": "nobody@example.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

    def test_resend_verified_user_gets_password_reset(self):
        """Verified users get a password reset email instead of verification."""
        from core.models import EmailRecord, Organization, OrganizationMembership, PasswordResetToken
        self.user.is_active = True
        self.user.save(update_fields=["is_active"])
        org = Organization.objects.create(display_name="TestOrg", created_by=self.user)
        OrganizationMembership.objects.create(
            organization=org, user=self.user, role="owner",
            status=OrganizationMembership.Status.ACTIVE,
        )
        response = self.client.post(
            "/api/v1/auth/resend-verification/",
            data={"email": "unverified@example.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(PasswordResetToken.objects.filter(user=self.user).exists())
        self.assertTrue(
            EmailRecord.objects.filter(
                recipient_email="unverified@example.com",
                email_type=EmailRecord.EmailType.PASSWORD_RESET,
            ).exists()
        )

    def test_resend_missing_email_returns_400(self):
        response = self.client.post(
            "/api/v1/auth/resend-verification/",
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_resend_works_after_previous_resend(self):
        """Regression: resend should work repeatedly without false 'already verified'."""
        # First resend (deletes old token, creates new one).
        self.client.post(
            "/api/v1/auth/resend-verification/",
            data={"email": "unverified@example.com"},
            content_type="application/json",
        )
        self.assertEqual(len(mail.outbox), 1)

        # Backdate so rate limit passes.
        EmailVerificationToken.objects.filter(user=self.user).update(
            created_at=timezone.now() - timedelta(minutes=5),
        )

        # Second resend — should still work.
        response = self.client.post(
            "/api/v1/auth/resend-verification/",
            data={"email": "unverified@example.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(EmailVerificationToken.objects.filter(user=self.user).count(), 1)


class LoginVerificationGateTests(TestCase):
    """Login blocks unverified users (is_active=False), passes active users through."""

    def test_login_unverified_returns_403(self):
        User.objects.create_user(
            username="gated@example.com",
            email="gated@example.com",
            password="secret123",
            is_active=False,
        )
        response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "gated@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "email_not_verified")

    def test_login_verified_returns_200(self):
        User.objects.create_user(
            username="gated@example.com",
            email="gated@example.com",
            password="secret123",
            is_active=True,
        )
        response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "gated@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("token", response.json()["data"])

    def test_login_legacy_user_returns_200(self):
        """Legacy/seed users have is_active=True by default — login works."""
        User.objects.create_user(
            username="legacy@example.com",
            email="legacy@example.com",
            password="secret123",
        )
        response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "legacy@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("token", response.json()["data"])
