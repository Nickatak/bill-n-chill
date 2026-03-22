from unittest.mock import patch
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.utils import timezone

from core.tests.common import *


def _verified_session(public_token, document_type, document_id, email):
    """Create a verified OTP session for public decision tests."""
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


class InvoiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm14",
            email="pm14@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm15",
            email="pm15@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner I",
            email="owneri@example.com",
            phone="555-9999",
            billing_address="9 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Invoice Project",
            status=Project.Status.ACTIVE,
            contract_value_original="150000.00",
            contract_value_current="151000.00",
            created_by=self.user,
        )
        self.cost_code, _ = CostCode.objects.get_or_create(
            code="40-400",
            organization=self.org,
            defaults={
                "name": "Invoice Cost Code",
                "is_active": True,
                "created_by": self.user,
            },
        )
        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Owner J",
            email="ownerj@example.com",
            phone="555-1010",
            billing_address="10 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Invoice Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )

    def _create_invoice(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "description": "Progress draw",
                        "quantity": "2",
                        "unit": "phase",
                        "unit_price": "500.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def test_public_invoice_detail_view_allows_unauthenticated_access(self):
        invoice_id = self._create_invoice()

        # Must send (leave draft) before public access is allowed
        self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        invoice = Invoice.objects.get(id=invoice_id)

        response = self.client.get(f"/api/v1/public/invoices/{invoice.public_token}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["id"], invoice.id)
        self.assertEqual(payload["invoice_number"], invoice.invoice_number)
        self.assertTrue(payload["public_ref"].endswith(f"--{invoice.public_token}"))
        self.assertEqual(payload["project_context"]["id"], self.project.id)
        self.assertEqual(
            payload["project_context"]["customer_display_name"],
            self.customer.display_name,
        )
        self.assertIn("organization_context", payload)
        self.assertIn("display_name", payload["organization_context"])
        self.assertIn("help_email", payload["organization_context"])
        self.assertEqual(len(payload["line_items"]), 1)

    def test_public_invoice_detail_view_not_found(self):
        response = self.client.get("/api/v1/public/invoices/notarealtoken/")
        self.assertEqual(response.status_code, 404)

    def test_public_invoice_decision_view_approves_sent_invoice_as_paid(self):
        invoice_id = self._create_invoice()
        sent = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)
        invoice = Invoice.objects.get(id=invoice_id)

        session = _verified_session(
            invoice.public_token, "invoice", invoice.id, self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/invoices/{invoice.public_token}/decision/",
            data={
                "decision": "approve",
                "note": "Payment approved.",
                "session_token": session.session_token,
                "signer_name": "Owner",
                "consent_accepted": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], Invoice.Status.PAID)
        self.assertEqual(payload["balance_due"], "0.00")

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(str(invoice.balance_due), "0.00")

    def test_public_invoice_decision_view_dispute_adds_status_note_event(self):
        invoice_id = self._create_invoice()
        sent = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)
        invoice = Invoice.objects.get(id=invoice_id)

        session = _verified_session(
            invoice.public_token, "invoice", invoice.id, self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/invoices/{invoice.public_token}/decision/",
            data={
                "decision": "dispute",
                "note": "Need itemized backup.",
                "session_token": session.session_token,
                "signer_name": "Owner",
                "consent_accepted": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], Invoice.Status.SENT)

        latest_event = InvoiceStatusEvent.objects.filter(invoice_id=invoice_id).first()
        self.assertIsNotNone(latest_event)
        self.assertEqual(latest_event.from_status, Invoice.Status.SENT)
        self.assertEqual(latest_event.to_status, Invoice.Status.SENT)
        self.assertIn("Disputed via public link", latest_event.note)

    def test_invoice_contract_requires_authentication(self):
        response = self.client.get("/api/v1/contracts/invoices/")
        self.assertEqual(response.status_code, 401)

    def test_invoice_contract_matches_model_transition_policy(self):
        response = self.client.get(
            "/api/v1/contracts/invoices/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]

        expected_statuses = [status for status, _label in Invoice.Status.choices]
        expected_labels = {status: label for status, label in Invoice.Status.choices}
        expected_transitions = {}
        for status in expected_statuses:
            next_statuses = list(Invoice.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
            next_statuses.sort(key=lambda value: expected_statuses.index(value))
            expected_transitions[status] = next_statuses

        self.assertEqual(payload["statuses"], expected_statuses)
        self.assertEqual(payload["status_labels"], expected_labels)
        self.assertEqual(payload["allowed_status_transitions"], expected_transitions)
        self.assertEqual(payload["default_create_status"], Invoice.Status.DRAFT)
        self.assertTrue(str(payload["policy_version"]).startswith("2026-03-01.invoices."))

    def test_invoice_create_calculates_totals_and_lines(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "description": "Progress draw",
                        "quantity": "2",
                        "unit": "phase",
                        "unit_price": "500.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], "draft")
        self.assertEqual(payload["invoice_number"], "INV-0001")
        self.assertEqual(payload["subtotal"], "1000.00")
        self.assertEqual(payload["tax_total"], "100.00")
        self.assertEqual(payload["total"], "1100.00")
        self.assertEqual(payload["balance_due"], "1100.00")
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(InvoiceLine.objects.count(), 1)
        self.assertEqual(InvoiceStatusEvent.objects.count(), 1)
        created_event = InvoiceStatusEvent.objects.first()
        self.assertIsNone(created_event.from_status)
        self.assertEqual(created_event.to_status, Invoice.Status.DRAFT)

    def test_invoice_create_uses_organization_invoice_defaults_when_payload_omits_them(self):
        organization = Organization.objects.create(
            display_name="Invoice Defaults Org",
            billing_street_1="100 Main St",
            billing_city="Austin",
            billing_state="TX",
            billing_zip="78701",
            default_invoice_due_delta=45,
            invoice_terms_and_conditions="Net 45. Late fee after due date.",
            created_by=self.user,
        )
        OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": organization,
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        # Move project to the new org so it's visible to the user
        self.project.organization = organization
        self.project.save(update_fields=["organization_id"])

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "line_items": [
                    {
                        "description": "Defaulted invoice draw",
                        "quantity": "1",
                        "unit": "phase",
                        "unit_price": "750.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        expected_issue_date = timezone.localdate().isoformat()
        expected_due_date = (timezone.localdate() + timedelta(days=45)).isoformat()

        self.assertEqual(payload["issue_date"], expected_issue_date)
        self.assertEqual(payload["due_date"], expected_due_date)
        self.assertEqual(payload["sender_name"], organization.display_name)
        self.assertEqual(payload["sender_email"], "")
        self.assertEqual(payload["sender_address"], organization.formatted_billing_address)
        self.assertEqual(payload["sender_logo_url"], "")
        self.assertEqual(payload["terms_text"], organization.invoice_terms_and_conditions)
        self.assertEqual(payload["footer_text"], "")
        self.assertEqual(payload["notes_text"], "")

    def test_invoice_create_allows_overriding_organization_invoice_defaults(self):
        organization = Organization.objects.create(
            display_name="Invoice Override Org",
            billing_street_1="Org Address",
            default_invoice_due_delta=30,
            invoice_terms_and_conditions="Org terms",
            created_by=self.user,
        )
        OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": organization,
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        # Move project to the new org so it's visible to the user
        self.project.organization = organization
        self.project.save(update_fields=["organization_id"])

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-20",
                "due_date": "2026-03-05",
                "sender_name": "Manual Sender",
                "sender_email": "manual@sender.example.com",
                "sender_address": "Manual Sender Address",
                "sender_logo_url": "https://example.com/logo-manual.png",
                "terms_text": "Manual terms",
                "footer_text": "Manual footer",
                "notes_text": "Manual notes",
                "line_items": [
                    {
                        "description": "Manual invoice draw",
                        "quantity": "1",
                        "unit": "phase",
                        "unit_price": "500.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["sender_name"], "Manual Sender")
        self.assertEqual(payload["sender_email"], "manual@sender.example.com")
        self.assertEqual(payload["sender_address"], "Manual Sender Address")
        self.assertEqual(payload["sender_logo_url"], "https://example.com/logo-manual.png")
        self.assertEqual(payload["terms_text"], "Manual terms")
        self.assertEqual(payload["footer_text"], "Manual footer")
        self.assertEqual(payload["notes_text"], "Manual notes")

    def test_invoice_patch_updates_sender_and_template_fields(self):
        invoice_id = self._create_invoice()

        response = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={
                "sender_name": "Updated Sender",
                "sender_email": "updated@sender.example.com",
                "sender_address": "Updated Sender Address",
                "sender_logo_url": "https://example.com/logo-updated.png",
                "terms_text": "Updated terms",
                "footer_text": "Updated footer",
                "notes_text": "Updated notes",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["sender_name"], "Updated Sender")
        self.assertEqual(payload["sender_email"], "updated@sender.example.com")
        self.assertEqual(payload["sender_address"], "Updated Sender Address")
        self.assertEqual(payload["sender_logo_url"], "https://example.com/logo-updated.png")
        self.assertEqual(payload["terms_text"], "Updated terms")
        self.assertEqual(payload["footer_text"], "Updated footer")
        self.assertEqual(payload["notes_text"], "Updated notes")

    def test_invoice_create_rounds_tax_half_up_to_cents(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "description": "Tiny taxable draw",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "0.05",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["subtotal"], "0.05")
        self.assertEqual(payload["tax_total"], "0.01")
        self.assertEqual(payload["total"], "0.06")
        self.assertEqual(payload["balance_due"], "0.06")

    def test_invoice_create_rolls_back_when_status_event_write_fails(self):
        with patch(
            "core.models.financial_auditing.invoice_status_event.InvoiceStatusEvent.record",
            side_effect=RuntimeError("capture-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    f"/api/v1/projects/{self.project.id}/invoices/",
                    data={
                        "issue_date": "2026-02-13",
                        "due_date": "2026-03-15",
                        "tax_percent": "10.00",
                        "line_items": [
                            {
                                "description": "Progress draw",
                                "quantity": "2",
                                "unit": "phase",
                                "unit_price": "500.00",
                            }
                        ],
                    },
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertEqual(Invoice.objects.count(), 0)
        self.assertEqual(InvoiceLine.objects.count(), 0)
        self.assertEqual(InvoiceStatusEvent.objects.count(), 0)

    def test_project_invoices_list_scoped_by_project_and_user(self):
        self._create_invoice()

        other_invoice = Invoice.objects.create(
            project=self.other_project,
            customer=self.other_project.customer,
            invoice_number="INV-0001",
            status=Invoice.Status.DRAFT,
            issue_date="2026-02-13",
            due_date="2026-03-15",
            created_by=self.other_user,
        )
        InvoiceLine.objects.create(
            invoice=other_invoice,
            description="Other user line",
            quantity="1",
            unit="ea",
            unit_price="10.00",
            line_total="10.00",
        )

        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/invoices/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["project"], self.project.id)

    def test_invoice_status_transition_validation_and_paid_balance(self):
        invoice_id = self._create_invoice()

        invalid = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "paid"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

        to_sent = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)
        self.assertEqual(to_sent.json()["data"]["status"], "sent")

        to_paid = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "paid"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_paid.status_code, 200)
        self.assertEqual(to_paid.json()["data"]["status"], "paid")
        self.assertEqual(to_paid.json()["data"]["balance_due"], "0.00")
        history = list(
            InvoiceStatusEvent.objects.filter(invoice_id=invoice_id).values_list("to_status", flat=True)
        )
        self.assertEqual(history, [Invoice.Status.PAID, Invoice.Status.SENT, Invoice.Status.DRAFT])

    def test_invoice_send_endpoint_moves_draft_to_sent(self):
        invoice_id = self._create_invoice()
        response = self.client.post(
            f"/api/v1/invoices/{invoice_id}/send/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "sent")
        latest_event = InvoiceStatusEvent.objects.filter(invoice_id=invoice_id).first()
        self.assertIsNotNone(latest_event)
        self.assertEqual(latest_event.from_status, Invoice.Status.DRAFT)
        self.assertEqual(latest_event.to_status, Invoice.Status.SENT)

    def test_invoice_status_events_endpoint_returns_history(self):
        invoice_id = self._create_invoice()
        sent = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        response = self.client.get(
            f"/api/v1/invoices/{invoice_id}/status-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["from_status"], Invoice.Status.DRAFT)
        self.assertEqual(rows[0]["to_status"], Invoice.Status.SENT)
        self.assertEqual(rows[1]["from_status"], None)
        self.assertEqual(rows[1]["to_status"], Invoice.Status.DRAFT)

    def test_invoice_status_note_without_transition_records_same_status_event(self):
        invoice_id = self._create_invoice()
        to_sent = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)

        note_only = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status_note": "Awaiting signed PO from owner."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(note_only.status_code, 200)
        self.assertEqual(note_only.json()["data"]["status"], Invoice.Status.SENT)

        latest_event = InvoiceStatusEvent.objects.filter(invoice_id=invoice_id).first()
        self.assertIsNotNone(latest_event)
        self.assertEqual(latest_event.from_status, Invoice.Status.SENT)
        self.assertEqual(latest_event.to_status, Invoice.Status.SENT)
        self.assertEqual(latest_event.note, "Awaiting signed PO from owner.")

        events_response = self.client.get(
            f"/api/v1/invoices/{invoice_id}/status-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(events_response.status_code, 200)
        rows = events_response.json()["data"]
        self.assertEqual(rows[0]["action_type"], "notate")

    def test_invoice_patch_line_items_recalculates_totals(self):
        invoice_id = self._create_invoice()

        response = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={
                "line_items": [
                    {
                        "description": "Updated draw",
                        "quantity": "3",
                        "unit": "phase",
                        "unit_price": "400.00",
                    }
                ],
                "tax_percent": "5.00",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["subtotal"], "1200.00")
        self.assertEqual(payload["tax_total"], "60.00")
        self.assertEqual(payload["total"], "1260.00")
        self.assertEqual(payload["balance_due"], "1260.00")

    def test_invoice_model_blocks_invalid_status_transition_on_direct_save(self):
        invoice_id = self._create_invoice()
        invoice = Invoice.objects.get(id=invoice_id)
        invoice.status = Invoice.Status.PAID
        with self.assertRaises(ValidationError):
            invoice.save()

    def test_invoice_model_blocks_due_date_before_issue_date(self):
        with self.assertRaises(ValidationError):
            Invoice.objects.create(
                project=self.project,
                customer=self.project.customer,
                invoice_number="INV-BAD-DATES",
                status=Invoice.Status.DRAFT,
                issue_date="2026-02-15",
                due_date="2026-02-14",
                subtotal="100.00",
                tax_total="0.00",
                total="100.00",
                balance_due="100.00",
                created_by=self.user,
            )

    def test_invoice_model_paid_status_sets_zero_balance_due(self):
        invoice_id = self._create_invoice()

        sent = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        invoice = Invoice.objects.get(id=invoice_id)
        invoice.status = Invoice.Status.PAID
        invoice.balance_due = "999.99"
        invoice.save()
        invoice.refresh_from_db()
        self.assertEqual(str(invoice.balance_due), "0.00")

    def test_invoice_paid_cannot_transition_to_void(self):
        """Paid is a terminal state — voiding a paid invoice is not allowed."""
        invoice_id = self._create_invoice()
        self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "paid"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        response = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("transition", response.json()["error"]["message"].lower())

    def test_invoice_partially_paid_cannot_transition_to_void(self):
        """Partially paid is a terminal state — voiding is not allowed."""
        invoice_id = self._create_invoice()
        self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "partially_paid"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        response = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("transition", response.json()["error"]["message"].lower())

    def test_invoice_partially_paid_can_revert_to_sent(self):
        """partially_paid -> sent is allowed for payment void reversal."""
        invoice_id = self._create_invoice()
        self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "partially_paid"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        # partially_paid -> sent is allowed (e.g. payment void reversal)
        response = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)

    def test_invoice_overdue_is_not_a_valid_status(self):
        """Overdue was removed from the status enum — it is now a computed condition."""
        self.assertFalse(
            any(status == "overdue" for status, _label in Invoice.Status.choices),
            "overdue should not be in Invoice.Status choices",
        )

    # ── Additional create scenarios ─────────────────────────────────

    def _create_simple_project(self):
        """Helper: create a simple project for additional invoice tests."""
        customer = Customer.objects.create(
            organization=self.org,
            display_name="Direct Client",
            email="direct@example.com",
            phone="555-0000",
            billing_address="1 Direct St",
            created_by=self.user,
        )
        return Project.objects.create(
            organization=self.org,
            customer=customer,
            name="Simple Project",
            status=Project.Status.ACTIVE,
            contract_value_original="0.00",
            contract_value_current="0.00",
            created_by=self.user,
        )

    def test_create_invoice_on_simple_project(self):
        """Invoice creation succeeds on a minimal project."""
        project = self._create_simple_project()
        response = self.client.post(
            f"/api/v1/projects/{project.id}/invoices/",
            data={
                "invoice_number": "INV-SIMPLE-1",
                "issue_date": "2025-01-01",
                "due_date": "2025-01-31",
                "customer": self.customer.id,
                "line_items": [
                    {
                        "description": "Consulting services",
                        "quantity": "1",
                        "unit_price": "500.00",
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201, response.json())
        invoice_data = response.json()["data"]
        self.assertEqual(invoice_data["total"], "500.00")

    def test_line_missing_description_rejected(self):
        """Lines without a description are rejected."""
        project = self._create_simple_project()
        response = self.client.post(
            f"/api/v1/projects/{project.id}/invoices/",
            data={
                "invoice_number": "INV-NODESC",
                "issue_date": "2025-01-01",
                "due_date": "2025-01-31",
                "customer": self.customer.id,
                "line_items": [
                    {
                        "description": "",
                        "quantity": "1",
                        "unit_price": "100.00",
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_invoice_on_prospect_project_activates_it(self):
        """Creating an invoice on a prospect project promotes it to active."""
        customer = Customer.objects.create(
            organization=self.org,
            display_name="Prospect Client",
            email="prospect@example.com",
            phone="555-0001",
            billing_address="1 Prospect St",
            created_by=self.user,
        )
        project = Project.objects.create(
            organization=self.org,
            customer=customer,
            name="Prospect Project",
            status=Project.Status.PROSPECT,
            contract_value_original="0.00",
            contract_value_current="0.00",
            created_by=self.user,
        )
        self.assertEqual(project.status, Project.Status.PROSPECT)

        response = self.client.post(
            f"/api/v1/projects/{project.id}/invoices/",
            data={
                "invoice_number": "INV-PROSPECT",
                "issue_date": "2025-01-01",
                "due_date": "2025-01-31",
                "customer": customer.id,
                "line_items": [
                    {
                        "description": "Quick job",
                        "quantity": "1",
                        "unit_price": "500.00",
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        project.refresh_from_db()
        self.assertEqual(project.status, Project.Status.ACTIVE)

    def test_create_invoice_on_active_project_stays_active(self):
        """Creating an invoice on an already-active project doesn't change status."""
        project = self._create_simple_project()  # already ACTIVE
        response = self.client.post(
            f"/api/v1/projects/{project.id}/invoices/",
            data={
                "invoice_number": "INV-ACTIVE",
                "issue_date": "2025-01-01",
                "due_date": "2025-01-31",
                "customer": project.customer_id,
                "line_items": [
                    {
                        "description": "Follow-up",
                        "quantity": "1",
                        "unit_price": "200.00",
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        project.refresh_from_db()
        self.assertEqual(project.status, Project.Status.ACTIVE)
