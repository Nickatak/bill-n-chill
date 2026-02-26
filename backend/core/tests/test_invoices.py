from unittest.mock import patch
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.utils import timezone

from core.tests.common import *

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
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            display_name="Owner I",
            email="owneri@example.com",
            phone="555-9999",
            billing_address="9 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Invoice Project",
            status=Project.Status.ACTIVE,
            contract_value_original="150000.00",
            contract_value_current="151000.00",
            created_by=self.user,
        )
        self.cost_code = CostCode.objects.create(
            code="40-400",
            name="Invoice Cost Code",
            is_active=True,
            created_by=self.user,
        )
        self.estimate = Estimate.objects.create(
            project=self.project,
            version=1,
            status=Estimate.Status.APPROVED,
            title="Invoice Baseline",
            created_by=self.user,
        )
        self.budget = Budget.objects.create(
            project=self.project,
            status=Budget.Status.ACTIVE,
            source_estimate=self.estimate,
            baseline_snapshot_json={},
            created_by=self.user,
        )
        self.budget_line = BudgetLine.objects.create(
            budget=self.budget,
            cost_code=self.cost_code,
            description="Invoice Progress Draw",
            budget_amount="5000.00",
        )
        self.generic_cost_code = CostCode.objects.create(
            code="99-901",
            name="Project Tools & Consumables",
            is_active=True,
            created_by=self.user,
        )
        self.generic_budget_line = BudgetLine.objects.create(
            budget=self.budget,
            cost_code=self.generic_cost_code,
            description="System: Project tools and consumables (non-client-billable)",
            budget_amount="0.00",
        )

        other_customer = Customer.objects.create(
            display_name="Owner J",
            email="ownerj@example.com",
            phone="555-1010",
            billing_address="10 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            customer=other_customer,
            name="Other Invoice Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        self.other_cost_code = CostCode.objects.create(
            code="40-401",
            name="Other Invoice Cost Code",
            is_active=True,
            created_by=self.other_user,
        )
        self.other_estimate = Estimate.objects.create(
            project=self.other_project,
            version=1,
            status=Estimate.Status.APPROVED,
            title="Other Invoice Baseline",
            created_by=self.other_user,
        )
        self.other_budget = Budget.objects.create(
            project=self.other_project,
            status=Budget.Status.ACTIVE,
            source_estimate=self.other_estimate,
            baseline_snapshot_json={},
            created_by=self.other_user,
        )
        self.other_budget_line = BudgetLine.objects.create(
            budget=self.other_budget,
            cost_code=self.other_cost_code,
            description="Other Invoice Draw",
            budget_amount="5000.00",
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
                        "budget_line": self.budget_line.id,
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
        self.assertTrue(str(payload["policy_version"]).startswith("2026-02-25.invoices."))

    def test_invoice_create_calculates_totals_and_lines(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "budget_line": self.budget_line.id,
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
            slug="invoice-defaults-org",
            logo_url="https://example.com/logo-default.png",
            invoice_sender_name="Nick Construction LLC",
            invoice_sender_email="billing@nickco.example.com",
            invoice_sender_address="100 Main St\nAustin, TX 78701",
            invoice_default_due_days=45,
            invoice_default_terms="Net 45. Late fee after due date.",
            invoice_default_footer="Thanks for your business.",
            invoice_default_notes="Please include invoice number with payment.",
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

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "line_items": [
                    {
                        "budget_line": self.budget_line.id,
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
        self.assertEqual(payload["sender_name"], organization.invoice_sender_name)
        self.assertEqual(payload["sender_email"], organization.invoice_sender_email)
        self.assertEqual(payload["sender_address"], organization.invoice_sender_address)
        self.assertEqual(payload["sender_logo_url"], organization.logo_url)
        self.assertEqual(payload["terms_text"], organization.invoice_default_terms)
        self.assertEqual(payload["footer_text"], organization.invoice_default_footer)
        self.assertEqual(payload["notes_text"], organization.invoice_default_notes)

    def test_invoice_create_allows_overriding_organization_invoice_defaults(self):
        organization = Organization.objects.create(
            display_name="Invoice Override Org",
            slug="invoice-override-org",
            logo_url="https://example.com/logo-org.png",
            invoice_sender_name="Org Sender",
            invoice_sender_email="ap@org.example.com",
            invoice_sender_address="Org Address",
            invoice_default_due_days=30,
            invoice_default_terms="Org terms",
            invoice_default_footer="Org footer",
            invoice_default_notes="Org notes",
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
                        "budget_line": self.budget_line.id,
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
                        "budget_line": self.budget_line.id,
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
            "core.views.accounts_receivable.invoices._record_invoice_status_event",
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
                                "budget_line": self.budget_line.id,
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
        self.assertEqual(FinancialAuditEvent.objects.filter(object_type="invoice").count(), 0)

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
                        "budget_line": self.budget_line.id,
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

    def test_invoice_send_blocks_when_total_exceeds_approved_scope_without_override(self):
        invoice_id = self._create_invoice()
        self.project.contract_value_current = "1000.00"
        self.project.save(update_fields=["contract_value_current", "updated_at"])

        response = self.client.post(
            f"/api/v1/invoices/{invoice_id}/send/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("scope_override", payload["error"]["fields"])
        self.assertEqual(InvoiceScopeOverrideEvent.objects.count(), 0)

    def test_invoice_send_scope_override_requires_note(self):
        invoice_id = self._create_invoice()
        self.project.contract_value_current = "1000.00"
        self.project.save(update_fields=["contract_value_current", "updated_at"])

        response = self.client.post(
            f"/api/v1/invoices/{invoice_id}/send/",
            data={"scope_override": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("scope_override_note", payload["error"]["fields"])
        invoice = Invoice.objects.get(id=invoice_id)
        self.assertEqual(invoice.status, Invoice.Status.DRAFT)

    def test_invoice_send_scope_override_creates_audit_note(self):
        invoice_id = self._create_invoice()
        self.project.contract_value_current = "1000.00"
        self.project.save(update_fields=["contract_value_current", "updated_at"])

        response = self.client.post(
            f"/api/v1/invoices/{invoice_id}/send/",
            data={
                "scope_override": True,
                "scope_override_note": "Emergency work billed before CO approval finalization.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "sent")

        events = InvoiceScopeOverrideEvent.objects.filter(invoice_id=invoice_id)
        self.assertEqual(events.count(), 1)
        event = events.first()
        self.assertEqual(event.note, "Emergency work billed before CO approval finalization.")
        self.assertEqual(str(event.approved_scope_limit), "1000.00")
        self.assertEqual(str(event.projected_billed_total), "1100.00")
        self.assertEqual(str(event.overage_amount), "100.00")

    def test_invoice_patch_billable_totals_over_scope_requires_override(self):
        invoice_id = self._create_invoice()
        self.project.contract_value_current = "1300.00"
        self.project.save(update_fields=["contract_value_current", "updated_at"])

        sent = self.client.post(
            f"/api/v1/invoices/{invoice_id}/send/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        blocked = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={
                "line_items": [
                    {
                        "budget_line": self.budget_line.id,
                        "description": "Expanded draw",
                        "quantity": "3",
                        "unit": "phase",
                        "unit_price": "500.00",
                    }
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("scope_override", blocked.json()["error"]["fields"])

        overridden = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={
                "line_items": [
                    {
                        "budget_line": self.budget_line.id,
                        "description": "Expanded draw",
                        "quantity": "3",
                        "unit": "phase",
                        "unit_price": "500.00",
                    }
                ],
                "scope_override": True,
                "scope_override_note": "Owner-approved out-of-scope item pending formal CO.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(overridden.status_code, 200)
        self.assertEqual(overridden.json()["data"]["total"], "1650.00")
        self.assertEqual(InvoiceScopeOverrideEvent.objects.filter(invoice_id=invoice_id).count(), 1)

    def test_invoice_create_adjustment_line_requires_adjustment_reason(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {
                        "line_type": "adjustment",
                        "description": "Manual billing adjustment",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("line_items", payload["error"]["fields"])

    def test_invoice_create_adjustment_line_with_reason_succeeds(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {
                        "line_type": "adjustment",
                        "adjustment_reason": "mobilization",
                        "internal_note": "Allowed quick adjustment for kickoff expense.",
                        "description": "Mobilization adjustment",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["line_items"][0]["line_type"], "adjustment")
        self.assertEqual(payload["line_items"][0]["adjustment_reason"], "mobilization")

    def test_invoice_create_scope_line_requires_budget_line(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {
                        "line_type": "scope",
                        "description": "Scope draw missing budget attribution",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("line_items", payload["error"]["fields"])

    def test_invoice_create_scope_line_rejects_budget_line_from_other_project(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {
                        "line_type": "scope",
                        "budget_line": self.other_budget_line.id,
                        "description": "Scope draw with foreign budget line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("budget_line", payload["error"]["fields"])

    def test_invoice_create_scope_line_rejects_generic_budget_line(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {
                        "line_type": "scope",
                        "budget_line": self.generic_budget_line.id,
                        "description": "Attempted generic billable scope",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("line_items", payload["error"]["fields"])

    def test_invoice_tax_only_patch_preserves_adjustment_line_metadata(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {
                        "line_type": "adjustment",
                        "adjustment_reason": "mobilization",
                        "internal_note": "Initial mobilization note.",
                        "description": "Mobilization adjustment",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        invoice_id = create.json()["data"]["id"]

        patch = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={"tax_percent": "8.25"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(patch.status_code, 200)
        line = patch.json()["data"]["line_items"][0]
        self.assertEqual(line["line_type"], "adjustment")
        self.assertEqual(line["adjustment_reason"], "mobilization")
        self.assertEqual(line["internal_note"], "Initial mobilization note.")

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
