"""Tests for transactional email helpers (core/utils/email.py).

Each email function is tested for: correct send_mail call, EmailRecord audit
row creation, and proper template rendering. Uses locmem backend so mail.outbox
is populated.
"""

from django.core import mail
from django.test import TestCase, override_settings

from core.models import (
    EmailRecord,
    EmailVerificationToken,
    Organization,
    OrganizationMembership,
    PasswordResetToken,
)
from core.utils.email import (
    send_document_decision_email,
    send_document_sent_email,
    send_otp_email,
    send_password_reset_email,
    send_verification_email,
)

from django.contrib.auth import get_user_model

User = get_user_model()


def _create_user(email="owner@test.com", is_active=True):
    user = User.objects.create_user(
        username=email, email=email, password="secret123", is_active=is_active,
    )
    return user


def _create_user_with_org(email="owner@test.com"):
    user = _create_user(email)
    org = Organization.objects.create(display_name="TestOrg", created_by=user)
    OrganizationMembership.objects.create(
        organization=org, user=user, role="owner",
        status=OrganizationMembership.Status.ACTIVE,
    )
    return user, org


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="http://localhost:3000",
    DEFAULT_FROM_EMAIL="noreply@test.com",
)
class SendVerificationEmailTests(TestCase):
    def setUp(self):
        self.user = _create_user(is_active=False)
        self.token_obj = EmailVerificationToken(user=self.user, email=self.user.email)
        self.token_obj.save()

    def test_sends_email_with_correct_recipient_and_subject(self):
        send_verification_email(self.user, self.token_obj)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["owner@test.com"])
        self.assertIn("Verify", msg.subject)

    def test_email_body_contains_verification_url(self):
        send_verification_email(self.user, self.token_obj)
        msg = mail.outbox[0]
        self.assertIn(f"/verify-email?token={self.token_obj.token}", msg.body)

    def test_creates_email_record(self):
        send_verification_email(self.user, self.token_obj)
        record = EmailRecord.objects.get(
            recipient_email="owner@test.com",
            email_type=EmailRecord.EmailType.VERIFICATION,
        )
        self.assertIn("Verify", record.subject)
        self.assertEqual(record.metadata_json["user_id"], self.user.id)
        self.assertEqual(record.metadata_json["verification_token_id"], self.token_obj.id)


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="http://localhost:3000",
    DEFAULT_FROM_EMAIL="noreply@test.com",
)
class SendPasswordResetEmailTests(TestCase):
    def setUp(self):
        self.user = _create_user()
        self.token_obj = PasswordResetToken(user=self.user, email=self.user.email)
        self.token_obj.save()

    def test_sends_reset_email(self):
        send_password_reset_email(self.user, self.token_obj)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["owner@test.com"])
        self.assertIn("Reset your password", msg.subject)

    def test_email_body_contains_reset_url(self):
        send_password_reset_email(self.user, self.token_obj)
        msg = mail.outbox[0]
        self.assertIn(f"/reset-password?token={self.token_obj.token}", msg.body)

    def test_security_alert_variant_subject(self):
        send_password_reset_email(self.user, self.token_obj, is_security_alert=True)
        msg = mail.outbox[0]
        self.assertIn("Password reset request", msg.subject)

    def test_creates_email_record(self):
        send_password_reset_email(self.user, self.token_obj)
        record = EmailRecord.objects.get(
            recipient_email="owner@test.com",
            email_type=EmailRecord.EmailType.PASSWORD_RESET,
        )
        self.assertEqual(record.metadata_json["is_security_alert"], False)

    def test_security_alert_metadata(self):
        send_password_reset_email(self.user, self.token_obj, is_security_alert=True)
        record = EmailRecord.objects.get(email_type=EmailRecord.EmailType.PASSWORD_RESET)
        self.assertTrue(record.metadata_json["is_security_alert"])


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="http://localhost:3000",
    DEFAULT_FROM_EMAIL="noreply@test.com",
)
class SendOtpEmailTests(TestCase):
    def test_sends_otp_email(self):
        send_otp_email("customer@example.com", "123456", "Quote", "Kitchen Remodel v1")
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["customer@example.com"])
        self.assertIn("verification code", msg.subject.lower())

    def test_creates_email_record(self):
        send_otp_email("customer@example.com", "654321", "Invoice", "INV-001")
        record = EmailRecord.objects.get(
            recipient_email="customer@example.com",
            email_type=EmailRecord.EmailType.OTP,
        )
        self.assertEqual(record.metadata_json["document_type_label"], "Invoice")
        self.assertEqual(record.metadata_json["document_title"], "INV-001")


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="http://localhost:3000",
    DEFAULT_FROM_EMAIL="noreply@test.com",
)
class SendDocumentSentEmailTests(TestCase):
    def setUp(self):
        self.user, self.org = _create_user_with_org()

    def test_sends_document_email(self):
        result = send_document_sent_email(
            document_type="Quote",
            document_title="Kitchen Remodel v1",
            public_url="https://app.example.com/public/quote/abc",
            recipient_email="customer@example.com",
            sender_user=self.user,
        )
        self.assertTrue(result)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["customer@example.com"])
        self.assertIn("Quote", msg.subject)
        self.assertIn("TestOrg", msg.subject)

    def test_creates_email_record(self):
        send_document_sent_email(
            document_type="Invoice",
            document_title="INV-001",
            public_url="https://app.example.com/public/invoice/xyz",
            recipient_email="client@example.com",
            sender_user=self.user,
        )
        record = EmailRecord.objects.get(
            recipient_email="client@example.com",
            email_type=EmailRecord.EmailType.DOCUMENT_SENT,
        )
        self.assertEqual(record.metadata_json["document_type"], "Invoice")
        self.assertEqual(record.metadata_json["document_title"], "INV-001")

    def test_returns_false_for_empty_recipient(self):
        result = send_document_sent_email(
            document_type="Quote",
            document_title="X",
            public_url="https://example.com",
            recipient_email="",
            sender_user=self.user,
        )
        self.assertFalse(result)
        self.assertEqual(len(mail.outbox), 0)

    def test_returns_false_for_none_recipient(self):
        result = send_document_sent_email(
            document_type="Quote",
            document_title="X",
            public_url="https://example.com",
            recipient_email=None,
            sender_user=self.user,
        )
        self.assertFalse(result)

    def test_strips_whitespace_from_recipient(self):
        send_document_sent_email(
            document_type="Quote",
            document_title="X",
            public_url="https://example.com",
            recipient_email="  padded@example.com  ",
            sender_user=self.user,
        )
        self.assertEqual(mail.outbox[0].to, ["padded@example.com"])


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="http://localhost:3000",
    DEFAULT_FROM_EMAIL="noreply@test.com",
)
class SendDocumentDecisionEmailTests(TestCase):
    def setUp(self):
        self.user, self.org = _create_user_with_org()

    def test_sends_decision_email(self):
        result = send_document_decision_email(
            user_id=self.user.id,
            document_type="quote",
            document_title="Kitchen Remodel v1",
            customer_name="Jane Doe",
            decision="approve",
            project_url="/projects/1/quotes",
        )
        self.assertTrue(result)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["owner@test.com"])
        self.assertIn("approved", msg.subject.lower())
        self.assertIn("Jane Doe", msg.subject)

    def test_creates_email_record(self):
        send_document_decision_email(
            user_id=self.user.id,
            document_type="invoice",
            document_title="INV-001",
            customer_name="Bob",
            decision="dispute",
            project_url="/projects/1/invoices",
        )
        record = EmailRecord.objects.get(
            recipient_email="owner@test.com",
            email_type=EmailRecord.EmailType.DOCUMENT_DECISION,
        )
        self.assertEqual(record.metadata_json["decision"], "dispute")
        self.assertEqual(record.metadata_json["customer_name"], "Bob")

    def test_returns_false_for_nonexistent_user(self):
        result = send_document_decision_email(
            user_id=99999,
            document_type="quote",
            document_title="X",
            customer_name="X",
            decision="approve",
            project_url="/projects/1/quotes",
        )
        self.assertFalse(result)
        self.assertEqual(len(mail.outbox), 0)

    def test_returns_false_for_user_without_email(self):
        no_email_user = User.objects.create_user(
            username="noemail", email="", password="secret123",
        )
        result = send_document_decision_email(
            user_id=no_email_user.id,
            document_type="quote",
            document_title="X",
            customer_name="X",
            decision="approve",
            project_url="/projects/1/quotes",
        )
        self.assertFalse(result)

    def test_subject_formats_document_type_correctly(self):
        send_document_decision_email(
            user_id=self.user.id,
            document_type="change_order",
            document_title="CO-1",
            customer_name="Alice",
            decision="reject",
            project_url="/projects/1/change-orders",
        )
        msg = mail.outbox[0]
        self.assertIn("Change Order", msg.subject)
        self.assertIn("rejected", msg.subject.lower())
