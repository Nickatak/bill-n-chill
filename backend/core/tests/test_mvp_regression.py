from core.tests.common import *


class MvpRegressionMoneyLoopTests(TestCase):
    """QA-02 baseline: protect the full money loop from regressions."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="pm_mvp",
            email="pm_mvp@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

        self.customer = Customer.objects.create(
            display_name="Bob",
            email="bob@example.com",
            phone="555-1212",
            billing_address="12 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Bathroom Remodel",
            status=Project.Status.ACTIVE,
            contract_value_original="1000.00",
            contract_value_current="1000.00",
            created_by=self.user,
        )
        self.cost_code = CostCode.objects.create(
            code="10-100",
            name="Demo",
            is_active=True,
            created_by=self.user,
        )

    def test_end_to_end_mvp_money_loop_regression(self):
        estimate_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Bathroom Estimate v1",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "200.00",
                        "markup_percent": "0",
                    },
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Tile",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "800.00",
                        "markup_percent": "0",
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(estimate_create.status_code, 201)
        estimate_id = estimate_create.json()["data"]["id"]
        self.assertEqual(estimate_create.json()["data"]["grand_total"], "1000.00")

        approve_estimate = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved", "status_note": "Accepted by client."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approve_estimate.status_code, 200)

        budget_convert = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(budget_convert.status_code, 201)
        budget = budget_convert.json()["data"]
        self.assertEqual(budget["status"], "active")
        self.assertEqual(len(budget["line_items"]), 2)

        create_co = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={"title": "Additional trim", "amount_delta": "200.00", "days_delta": 1},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create_co.status_code, 201)
        co_id = create_co.json()["data"]["id"]

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{co_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)
        to_co_approved = self.client.patch(
            f"/api/v1/change-orders/{co_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_co_approved.status_code, 200)

        self.project.refresh_from_db()
        self.assertEqual(str(self.project.contract_value_current), "1200.00")

        invoice_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/invoices/",
            data={
                "line_items": [
                    {
                        "description": "Draw 1",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "1200.00",
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
        self.assertEqual(invoice_send.json()["data"]["status"], "sent")

        inbound_payment = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={
                "direction": "inbound",
                "method": "ach",
                "status": "settled",
                "amount": "1200.00",
                "reference_number": "AR-1",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(inbound_payment.status_code, 201)
        inbound_payment_id = inbound_payment.json()["data"]["id"]

        inbound_allocate = self.client.post(
            f"/api/v1/payments/{inbound_payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice_id, "applied_amount": "1200.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(inbound_allocate.status_code, 201)

        vendor = Vendor.objects.create(
            name="Tile Vendor",
            email="vendor@example.com",
            created_by=self.user,
        )
        vendor_bill_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={"vendor": vendor.id, "bill_number": "VB-100", "total": "500.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(vendor_bill_create.status_code, 201)
        vendor_bill_id = vendor_bill_create.json()["data"]["id"]

        to_received = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "received"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_received.status_code, 200)
        to_approved = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)
        to_scheduled = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "scheduled"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_scheduled.status_code, 200)

        outbound_payment = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={
                "direction": "outbound",
                "method": "check",
                "status": "settled",
                "amount": "500.00",
                "reference_number": "AP-1",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(outbound_payment.status_code, 201)
        outbound_payment_id = outbound_payment.json()["data"]["id"]

        outbound_allocate = self.client.post(
            f"/api/v1/payments/{outbound_payment_id}/allocate/",
            data={
                "allocations": [
                    {
                        "target_type": "vendor_bill",
                        "target_id": vendor_bill_id,
                        "applied_amount": "500.00",
                    }
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(outbound_allocate.status_code, 201)

        summary_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/financial-summary/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(summary_response.status_code, 200)
        summary = summary_response.json()["data"]
        self.assertEqual(summary["contract_value_original"], "1000.00")
        self.assertEqual(summary["contract_value_current"], "1200.00")
        self.assertEqual(summary["approved_change_orders_total"], "200.00")
        self.assertEqual(summary["invoiced_to_date"], "1200.00")
        self.assertEqual(summary["paid_to_date"], "1200.00")
        self.assertEqual(summary["ar_outstanding"], "0.00")
        self.assertEqual(summary["ap_total"], "500.00")
        self.assertEqual(summary["ap_paid"], "500.00")
        self.assertEqual(summary["ap_outstanding"], "0.00")

        invoice = Invoice.objects.get(id=invoice_id)
        vendor_bill = VendorBill.objects.get(id=vendor_bill_id)
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(str(invoice.balance_due), "0.00")
        self.assertEqual(vendor_bill.status, VendorBill.Status.PAID)
        self.assertEqual(str(vendor_bill.balance_due), "0.00")
