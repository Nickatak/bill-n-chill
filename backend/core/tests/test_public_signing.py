"""Tests for public document signing — OTP verification, signing ceremony, and ceremony validation."""

from datetime import timedelta

from django.utils import timezone

from core.tests.common import *
from core.utils.signing import (
    CEREMONY_CONSENT_TEXT,
    CEREMONY_CONSENT_TEXT_VERSION,
    compute_consent_text_version,
    compute_document_content_hash,
    mask_email,
)


def _create_verified_session(public_token, document_type="quote", document_id=1, email="owner@example.com"):
    """Create a DocumentAccessSession that has been OTP-verified with an active session.

    Utility for tests that need a valid session to submit decisions.
    """
    session = DocumentAccessSession(
        document_type=document_type,
        document_id=document_id,
        public_token=public_token,
        recipient_email=email,
    )
    session.save()
    session.verified_at = timezone.now()
    session.session_expires_at = timezone.now() + timedelta(minutes=60)
    session.save(update_fields=["verified_at", "session_expires_at"])
    return session


class DocumentAccessSessionModelTests(TestCase):
    """Tests for the DocumentAccessSession model lifecycle."""

    def test_save_auto_generates_code_and_session_token(self):
        session = DocumentAccessSession(
            document_type="quote",
            document_id=1,
            public_token="abc123token",
            recipient_email="test@example.com",
        )
        session.save()
        self.assertEqual(len(session.code), 6)
        self.assertTrue(session.code.isdigit())
        self.assertTrue(len(session.session_token) > 20)
        self.assertIsNotNone(session.expires_at)

    def test_is_expired_false_for_fresh_session(self):
        session = DocumentAccessSession(
            document_type="quote",
            document_id=1,
            public_token="abc123token",
            recipient_email="test@example.com",
        )
        session.save()
        self.assertFalse(session.is_expired)

    def test_is_expired_true_when_past_expiry(self):
        session = DocumentAccessSession(
            document_type="quote",
            document_id=1,
            public_token="abc123token",
            recipient_email="test@example.com",
        )
        session.save()
        session.expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["expires_at"])
        self.assertTrue(session.is_expired)

    def test_is_verified_false_before_verification(self):
        session = DocumentAccessSession(
            document_type="quote",
            document_id=1,
            public_token="abc123token",
            recipient_email="test@example.com",
        )
        session.save()
        self.assertFalse(session.is_verified)

    def test_is_verified_true_after_verification(self):
        session = _create_verified_session("abc123token")
        self.assertTrue(session.is_verified)

    def test_is_session_valid_true_for_fresh_verified_session(self):
        session = _create_verified_session("abc123token")
        self.assertTrue(session.is_session_valid)

    def test_is_session_valid_false_when_session_expired(self):
        session = _create_verified_session("abc123token")
        session.session_expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["session_expires_at"])
        self.assertFalse(session.is_session_valid)

    def test_is_session_valid_false_before_verification(self):
        session = DocumentAccessSession(
            document_type="quote",
            document_id=1,
            public_token="abc123token",
            recipient_email="test@example.com",
        )
        session.save()
        self.assertFalse(session.is_session_valid)

    def test_lookup_for_verification_success(self):
        session = DocumentAccessSession(
            document_type="quote",
            document_id=1,
            public_token="abc123token",
            recipient_email="test@example.com",
        )
        session.save()
        found, error = DocumentAccessSession.lookup_for_verification("abc123token", session.code)
        self.assertIsNone(error)
        self.assertEqual(found.id, session.id)

    def test_lookup_for_verification_not_found(self):
        found, error = DocumentAccessSession.lookup_for_verification("abc123token", "999999")
        self.assertEqual(error, "not_found")
        self.assertIsNone(found)

    def test_lookup_for_verification_expired(self):
        session = DocumentAccessSession(
            document_type="quote",
            document_id=1,
            public_token="abc123token",
            recipient_email="test@example.com",
        )
        session.save()
        session.expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["expires_at"])
        found, error = DocumentAccessSession.lookup_for_verification("abc123token", session.code)
        self.assertEqual(error, "expired")
        self.assertIsNone(found)

    def test_lookup_for_verification_already_verified(self):
        session = _create_verified_session("abc123token")
        found, error = DocumentAccessSession.lookup_for_verification("abc123token", session.code)
        self.assertEqual(error, "already_verified")
        self.assertIsNone(found)

    def test_lookup_valid_session_success(self):
        session = _create_verified_session("abc123token")
        found, error = DocumentAccessSession.lookup_valid_session("abc123token", session.session_token)
        self.assertIsNone(error)
        self.assertEqual(found.id, session.id)

    def test_lookup_valid_session_not_found(self):
        found, error = DocumentAccessSession.lookup_valid_session("abc123token", "nonexistent")
        self.assertEqual(error, "not_found")
        self.assertIsNone(found)

    def test_lookup_valid_session_expired(self):
        session = _create_verified_session("abc123token")
        session.session_expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["session_expires_at"])
        found, error = DocumentAccessSession.lookup_valid_session("abc123token", session.session_token)
        self.assertEqual(error, "expired")
        self.assertIsNone(found)


class SigningCeremonyRecordModelTests(TestCase):
    """Tests for the SigningCeremonyRecord immutable audit artifact."""

    def test_record_creates_ceremony(self):
        record = SigningCeremonyRecord.record(
            document_type="quote",
            document_id=42,
            public_token="abc123token",
            decision="approve",
            signer_name="Jane Owner",
            signer_email="jane@example.com",
            content_hash="a" * 64,
            consent_text_version=CEREMONY_CONSENT_TEXT_VERSION,
            consent_text_snapshot=CEREMONY_CONSENT_TEXT,
        )
        self.assertEqual(record.document_type, "quote")
        self.assertEqual(record.document_id, 42)
        self.assertEqual(record.signer_name, "Jane Owner")
        self.assertEqual(record.decision, "approve")
        self.assertTrue(record.email_verified)
        self.assertIsNotNone(record.ceremony_completed_at)

    def test_record_is_immutable(self):
        record = SigningCeremonyRecord.record(
            document_type="quote",
            document_id=42,
            public_token="abc123token",
            decision="approve",
            signer_name="Jane Owner",
            signer_email="jane@example.com",
            content_hash="a" * 64,
            consent_text_version=CEREMONY_CONSENT_TEXT_VERSION,
            consent_text_snapshot=CEREMONY_CONSENT_TEXT,
        )
        record.signer_name = "Tampered"
        with self.assertRaises(Exception):
            record.save()


class SigningUtilitiesTests(TestCase):
    """Tests for content hashing, email masking, and consent text utilities."""

    def test_compute_quote_content_hash_is_deterministic(self):
        data = {
            "title": "Kitchen Remodel",
            "version": 1,
            "tax_percent": "8.25",
            "terms_text": "Net 30",
            "line_items": [
                {"description": "Demo", "quantity": "2", "unit_price": "500", "markup_percent": "10", "cost_code": 1, "unit": "day"},
            ],
        }
        hash1 = compute_document_content_hash("quote", data)
        hash2 = compute_document_content_hash("quote", data)
        self.assertEqual(hash1, hash2)
        self.assertEqual(len(hash1), 64)

    def test_compute_change_order_content_hash_is_deterministic(self):
        data = {
            "family_key": 1,
            "reason": "Scope change",
            "amount_delta": "1500.00",
            "terms_text": "Net 30",
            "line_items": [
                {"description": "Additional framing", "amount_delta": "1500.00", "budget_line": 1, "line_type": "addition", "adjustment_reason": ""},
            ],
        }
        hash1 = compute_document_content_hash("change_order", data)
        hash2 = compute_document_content_hash("change_order", data)
        self.assertEqual(hash1, hash2)

    def test_compute_invoice_content_hash_is_deterministic(self):
        data = {
            "invoice_number": "INV-001",
            "total": "5000.00",
            "balance_due": "5000.00",
            "tax_percent": "0.00",
            "terms_text": "Due on receipt",
            "line_items": [
                {"description": "Labor", "quantity": "10", "unit_price": "500", "cost_code": 1, "budget_line": 1, "unit": "hr", "line_type": "labor"},
            ],
        }
        hash1 = compute_document_content_hash("invoice", data)
        hash2 = compute_document_content_hash("invoice", data)
        self.assertEqual(hash1, hash2)

    def test_content_hash_changes_with_content(self):
        data1 = {"title": "Kitchen Remodel", "version": 1, "tax_percent": "8.25", "terms_text": "", "line_items": []}
        data2 = {"title": "Bath Remodel", "version": 1, "tax_percent": "8.25", "terms_text": "", "line_items": []}
        self.assertNotEqual(
            compute_document_content_hash("quote", data1),
            compute_document_content_hash("quote", data2),
        )

    def test_content_hash_excludes_volatile_fields(self):
        base = {"title": "Kitchen", "version": 1, "tax_percent": "0", "terms_text": "", "line_items": []}
        with_volatile = {**base, "status": "sent", "updated_at": "2026-01-01", "id": 99}
        self.assertEqual(
            compute_document_content_hash("quote", base),
            compute_document_content_hash("quote", with_volatile),
        )

    def test_mask_email_standard(self):
        self.assertEqual(mask_email("john@example.com"), "j***@example.com")

    def test_mask_email_single_char(self):
        self.assertEqual(mask_email("j@example.com"), "j***@example.com")

    def test_mask_email_empty(self):
        self.assertEqual(mask_email(""), "")

    def test_consent_text_version_is_deterministic(self):
        v1 = compute_consent_text_version(CEREMONY_CONSENT_TEXT)
        v2 = compute_consent_text_version(CEREMONY_CONSENT_TEXT)
        self.assertEqual(v1, v2)
        self.assertEqual(v1, CEREMONY_CONSENT_TEXT_VERSION)


class OtpViewFlowTests(TestCase):
    """Integration tests for OTP request and verification endpoints."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="signing_pm",
            email="signing_pm@example.com",
            password="secret123",
        )
        self.org = _bootstrap_org(self.user)
        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Signing Owner",
            email="owner@example.com",
            phone="555-1111",
            billing_address="1 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="OTP Test Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )
        self.quote = Quote.objects.create(
            project=self.project,
            version=1,
            title="OTP Test Quote",
            created_by=self.user,
            status=Quote.Status.SENT,
        )

    def test_request_otp_returns_email_hint(self):
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertTrue(data["otp_required"])
        self.assertEqual(data["email_hint"], "o***@example.com")
        self.assertEqual(data["expires_in"], 600)

    def test_request_otp_no_customer_email_returns_422(self):
        self.customer.email = ""
        self.customer.save(update_fields=["email"])
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "customer_email_required")

    def test_request_otp_rate_limit_within_60s(self):
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "rate_limited")

    def test_request_otp_invalid_document_returns_404(self):
        response = self.client.post(
            "/api/v1/public/quote/nonexistent_token/otp/",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_verify_otp_valid_code_returns_session_token(self):
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        session = DocumentAccessSession.objects.filter(
            public_token=self.quote.public_token,
        ).first()

        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": session.code},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("session_token", data)
        self.assertEqual(data["expires_in"], 3600)

    def test_verify_otp_wrong_code_returns_404(self):
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": "000000"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)

    def test_verify_otp_expired_code_returns_410(self):
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        session = DocumentAccessSession.objects.filter(
            public_token=self.quote.public_token,
        ).first()
        session.expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["expires_at"])

        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": session.code},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_verify_otp_already_verified_returns_409(self):
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        session = DocumentAccessSession.objects.filter(
            public_token=self.quote.public_token,
        ).first()
        # Verify once.
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": session.code},
            content_type="application/json",
        )
        # Try again.
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": session.code},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    def test_verify_otp_missing_code_returns_400(self):
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class CeremonyDecisionValidationTests(TestCase):
    """Tests for ceremony validation on public decision endpoints."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="ceremony_pm",
            email="ceremony_pm@example.com",
            password="secret123",
        )
        self.org = _bootstrap_org(self.user)
        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Ceremony Owner",
            email="ceremony_owner@example.com",
            phone="555-2222",
            billing_address="2 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Ceremony Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )
        self.quote = Quote.objects.create(
            project=self.project,
            version=1,
            title="Ceremony Quote",
            created_by=self.user,
            status=Quote.Status.SENT,
        )

    def _ceremony_payload(self, session, **overrides):
        """Build a valid ceremony payload dict, allowing overrides for specific fields."""
        base = {
            "decision": "approve",
            "session_token": session.session_token,
            "signer_name": "Jane Owner",
            "consent_accepted": True,
            "note": "Looks good.",
        }
        base.update(overrides)
        return base

    def test_decision_with_valid_ceremony_succeeds(self):
        session = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], Quote.Status.APPROVED)

    def test_decision_creates_signing_ceremony_record(self):
        session = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session),
            content_type="application/json",
        )
        record = SigningCeremonyRecord.objects.filter(
            document_type="quote",
            document_id=self.quote.id,
        ).first()
        self.assertIsNotNone(record)
        self.assertEqual(record.signer_name, "Jane Owner")
        self.assertEqual(record.signer_email, self.customer.email)
        self.assertTrue(record.email_verified)
        self.assertEqual(len(record.content_hash), 64)
        self.assertEqual(record.consent_text_version, CEREMONY_CONSENT_TEXT_VERSION)
        self.assertIn("electronic signature", record.consent_text_snapshot)

    def test_decision_without_session_token_returns_403(self):
        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data={
                "decision": "approve",
                "signer_name": "Jane Owner",
                "consent_accepted": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "session_required")

    def test_decision_without_signer_name_returns_400(self):
        session = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session, signer_name=""),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_decision_without_consent_returns_400(self):
        session = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session, consent_accepted=False),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_decision_with_invalid_session_returns_403(self):
        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data={
                "decision": "approve",
                "session_token": "invalid_token",
                "signer_name": "Jane Owner",
                "consent_accepted": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_decision_with_expired_session_returns_403(self):
        session = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        session.session_expires_at = timezone.now() - timedelta(minutes=1)
        session.save(update_fields=["session_expires_at"])

        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_decision_without_customer_email_returns_422(self):
        self.customer.email = ""
        self.customer.save(update_fields=["email"])

        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data={
                "decision": "approve",
                "session_token": "anything",
                "signer_name": "Jane Owner",
                "consent_accepted": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "customer_email_required")


class PublicSigningEdgeCaseTests(TestCase):
    """Edge case tests for public signing — double-approve, cross-doc reuse, OTP limits, etc."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="edge_pm",
            email="edge_pm@example.com",
            password="secret123",
        )
        self.org = _bootstrap_org(self.user)
        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Edge Owner",
            email="edge_owner@example.com",
            phone="555-3333",
            billing_address="3 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Edge Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )
        self.quote = Quote.objects.create(
            project=self.project,
            version=1,
            title="Edge Quote",
            created_by=self.user,
            status=Quote.Status.SENT,
        )

    def _ceremony_payload(self, session, **overrides):
        base = {
            "decision": "approve",
            "session_token": session.session_token,
            "signer_name": "Edge Owner",
            "consent_accepted": True,
        }
        base.update(overrides)
        return base

    def test_double_approve_returns_409_conflict(self):
        """Approving an already-approved quote returns 409."""
        session_1 = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        response_1 = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session_1),
            content_type="application/json",
        )
        self.assertEqual(response_1.status_code, 200)
        self.assertEqual(response_1.json()["data"]["status"], Quote.Status.APPROVED)

        # Second attempt with a fresh session should fail — quote is no longer SENT.
        session_2 = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        response_2 = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session_2),
            content_type="application/json",
        )
        self.assertEqual(response_2.status_code, 409)
        self.assertEqual(response_2.json()["error"]["code"], "conflict")

    def test_session_token_scoped_to_document(self):
        """A session token for quote_a cannot be used on quote_b's decision endpoint."""
        quote_b = Quote.objects.create(
            project=self.project,
            version=2,
            title="Edge Quote B",
            created_by=self.user,
            status=Quote.Status.SENT,
        )
        session_a = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        # Use session_a's token against quote_b's endpoint.
        response = self.client.post(
            f"/api/v1/public/quotes/{quote_b.public_token}/decision/",
            data=self._ceremony_payload(session_a),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_max_otp_attempts_then_new_otp_succeeds(self):
        """After max failed attempts, requesting a new OTP and verifying it works."""
        # Request first OTP.
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        session = DocumentAccessSession.objects.filter(
            public_token=self.quote.public_token,
        ).first()

        # Max out failed attempts.
        session.failed_attempts = 10
        session.save(update_fields=["failed_attempts"])

        # Verify should fail with max_attempts.
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": session.code},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "max_attempts")

        # Bypass rate limit by aging the first session.
        session.created_at = timezone.now() - timedelta(seconds=120)
        session.save(update_fields=["created_at"])

        # Request new OTP.
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)

        new_session = DocumentAccessSession.objects.filter(
            public_token=self.quote.public_token,
            verified_at__isnull=True,
        ).order_by("-created_at").first()
        self.assertNotEqual(new_session.id, session.id)

        # Verify the new OTP — fresh counter should allow it.
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": new_session.code},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("session_token", response.json()["data"])

    def test_reject_decision_creates_ceremony_record(self):
        """Rejecting an quote creates a SigningCeremonyRecord with decision='reject'."""
        session = _create_verified_session(
            self.quote.public_token,
            document_type="quote",
            document_id=self.quote.id,
            email=self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/quotes/{self.quote.public_token}/decision/",
            data=self._ceremony_payload(session, decision="reject"),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], Quote.Status.REJECTED)

        record = SigningCeremonyRecord.objects.filter(
            document_type="quote",
            document_id=self.quote.id,
        ).first()
        self.assertIsNotNone(record)
        self.assertEqual(record.decision, "reject")

    def test_empty_whitespace_otp_code_returns_400(self):
        """Submitting a whitespace-only OTP code returns 400 validation_error."""
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": "   "},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_decision_on_draft_quote_returns_409(self):
        """Attempting a decision on a DRAFT quote returns 409 conflict."""
        draft_quote = Quote.objects.create(
            project=self.project,
            version=2,
            title="Draft Quote",
            created_by=self.user,
            status=Quote.Status.DRAFT,
        )
        session = _create_verified_session(
            draft_quote.public_token,
            document_type="quote",
            document_id=draft_quote.id,
            email=self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/quotes/{draft_quote.public_token}/decision/",
            data=self._ceremony_payload(session),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "conflict")

    def test_max_attempts_blocks_correct_code(self):
        """Even the correct OTP code is rejected after max failed attempts."""
        self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/",
            content_type="application/json",
        )
        session = DocumentAccessSession.objects.filter(
            public_token=self.quote.public_token,
        ).first()

        # Set failed_attempts to MAX_VERIFY_ATTEMPTS.
        session.failed_attempts = 10
        session.save(update_fields=["failed_attempts"])

        # Submit the correct code — should still be rejected.
        response = self.client.post(
            f"/api/v1/public/quote/{self.quote.public_token}/otp/verify/",
            data={"code": session.code},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "max_attempts")
