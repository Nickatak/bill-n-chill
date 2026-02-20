from django.core.exceptions import ValidationError

from core.tests.common import *


class FinancialAuditTrailTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm_audit",
            email="pm_audit@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm_audit_other",
            email="pm_audit_other@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            display_name="Audit Owner",
            email="audit-owner@example.com",
            phone="555-8888",
            billing_address="88 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Audit Project",
            status=Project.Status.ACTIVE,
            contract_value_original="1000.00",
            contract_value_current="1000.00",
            created_by=self.user,
        )
        self.cost_code = CostCode.objects.create(
            code="99-999",
            name="General",
            is_active=True,
            created_by=self.user,
        )

    def test_money_workflow_creates_project_audit_events_and_events_are_immutable(self):
        estimate_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Estimate A",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Scope line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "1000.00",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(estimate_create.status_code, 201)
        estimate_id = estimate_create.json()["data"]["id"]

        to_sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent", "status_note": "Sent to owner."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)

        to_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved", "status_note": "Owner approved."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)

        budget_convert = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(budget_convert.status_code, 200)

        change_order_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={"title": "Upgrade", "amount_delta": "250.00", "days_delta": 1},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(change_order_create.status_code, 201)
        change_order_id = change_order_create.json()["data"]["id"]

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)
        to_co_approved = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_co_approved.status_code, 200)

        invoice_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "line_items": [
                    {
                        "description": "Draw 1",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "1000.00",
                    }
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invoice_create.status_code, 201)
        invoice_id = invoice_create.json()["data"]["id"]

        invoice_send = self.client.post(
            f"/api/v1/invoices/{invoice_id}/send/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invoice_send.status_code, 200)

        vendor = Vendor.objects.create(name="Audit Vendor", created_by=self.user)
        vendor_bill_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={"vendor": vendor.id, "bill_number": "VB-1", "total": "200.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(vendor_bill_create.status_code, 201)
        vendor_bill_id = vendor_bill_create.json()["data"]["id"]

        vendor_bill_approve = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "received"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(vendor_bill_approve.status_code, 200)

        inbound_payment = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={
                "direction": "inbound",
                "method": "ach",
                "status": "settled",
                "amount": "1000.00",
                "reference_number": "PMT-IN-1",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(inbound_payment.status_code, 201)
        inbound_payment_id = inbound_payment.json()["data"]["id"]

        allocate_inbound = self.client.post(
            f"/api/v1/payments/{inbound_payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice_id, "applied_amount": "1000.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(allocate_inbound.status_code, 201)

        events_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/audit-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(events_response.status_code, 200)
        events = events_response.json()["data"]
        self.assertGreaterEqual(len(events), 8)

        event_types = {row["event_type"] for row in events}
        self.assertIn("estimate_status_changed", event_types)
        self.assertIn("budget_converted", event_types)
        self.assertIn("change_order_updated", event_types)
        self.assertIn("invoice_updated", event_types)
        self.assertIn("vendor_bill_updated", event_types)
        self.assertIn("payment_updated", event_types)
        self.assertIn("payment_allocated", event_types)

        sample = FinancialAuditEvent.objects.filter(project=self.project, created_by=self.user).first()
        self.assertIsNotNone(sample)
        self.assertEqual(sample.created_by_id, self.user.id)
        self.assertIsNotNone(sample.created_at)

        sample.note = "mutate"
        with self.assertRaises(ValidationError):
            sample.save()
        with self.assertRaises(ValidationError):
            sample.delete()

    def test_audit_events_endpoint_requires_auth_and_scopes_by_owner(self):
        no_auth = self.client.get(f"/api/v1/projects/{self.project.id}/audit-events/")
        self.assertEqual(no_auth.status_code, 401)

        other_customer = Customer.objects.create(
            display_name="Other Owner",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            customer=other_customer,
            name="Other Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        FinancialAuditEvent.objects.create(
            project=other_project,
            event_type=FinancialAuditEvent.EventType.PAYMENT_UPDATED,
            object_type="payment",
            object_id=999,
            to_status="settled",
            amount="20.00",
            note="seed",
            created_by=self.other_user,
        )

        hidden = self.client.get(
            f"/api/v1/projects/{other_project.id}/audit-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(hidden.status_code, 404)
