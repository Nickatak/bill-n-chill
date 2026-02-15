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

    def _create_invoice(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
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

    def test_invoice_create_calculates_totals_and_lines(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
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

    def test_invoice_patch_line_items_recalculates_totals(self):
        invoice_id = self._create_invoice()

        response = self.client.patch(
            f"/api/v1/invoices/{invoice_id}/",
            data={
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
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
                        "cost_code": self.cost_code.id,
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
                        "cost_code": self.cost_code.id,
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
