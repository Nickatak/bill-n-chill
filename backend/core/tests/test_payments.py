from django.core.exceptions import ValidationError

from core.tests.common import *


class PaymentTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm20",
            email="pm20@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm21",
            email="pm21@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner M",
            email="ownerm@example.com",
            phone="555-4040",
            billing_address="13 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Payment Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Owner N",
            email="ownern@example.com",
            phone="555-5050",
            billing_address="14 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Payment Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )

    def _create_payment(self, *, status="settled", amount="800.00", direction="inbound",
                        target_type="", target_id=None):
        data = {
            "direction": direction,
            "method": "ach",
            "status": status,
            "amount": amount,
            "payment_date": "2026-02-13",
            "reference_number": "PMT-1001",
            "notes": "Initial payment entry.",
        }
        if target_type:
            data["target_type"] = target_type
        if target_id:
            data["target_id"] = target_id
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data=data,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def _create_invoice(self, *, total="1000.00", status="sent"):
        return Invoice.objects.create(
            project=self.project,
            customer=self.project.customer,
            invoice_number=f"INV-{Invoice.objects.filter(project=self.project).count() + 1:04d}",
            status=status,
            issue_date="2026-02-13",
            due_date="2026-03-15",
            subtotal=total,
            total=total,
            balance_due=total,
            created_by=self.user,
        )

    def _create_vendor_bill(self, *, total="1000.00", status="approved"):
        vendor = Vendor.objects.create(
            name=f"Vendor {Vendor.objects.filter(created_by=self.user, organization=self.org).count() + 1}",
            email=f"vendor{Vendor.objects.filter(created_by=self.user).count() + 1}@example.com",
            created_by=self.user,
            organization=self.org,
        )
        return VendorBill.objects.create(
            project=self.project,
            vendor=vendor,
            bill_number=f"B-{VendorBill.objects.filter(project=self.project).count() + 1000}",
            status=status,
            issue_date="2026-02-13",
            due_date="2026-03-15",
            total=total,
            balance_due=total,
            created_by=self.user,
        )

    def test_payment_contract_requires_authentication(self):
        response = self.client.get("/api/v1/contracts/payments/")
        self.assertEqual(response.status_code, 401)

    def test_payment_contract_matches_model_transition_policy(self):
        response = self.client.get(
            "/api/v1/contracts/payments/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]

        expected_statuses = [status for status, _label in Payment.Status.choices]
        expected_labels = {status: label for status, label in Payment.Status.choices}
        expected_transitions = {}
        for status in expected_statuses:
            next_statuses = list(Payment.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
            next_statuses.sort(key=lambda value: expected_statuses.index(value))
            expected_transitions[status] = next_statuses
        expected_terminal_statuses = [
            status for status in expected_statuses if not expected_transitions.get(status, [])
        ]

        self.assertEqual(payload["statuses"], expected_statuses)
        self.assertEqual(payload["status_labels"], expected_labels)
        self.assertEqual(
            payload["directions"],
            [direction for direction, _label in Payment.Direction.choices],
        )
        self.assertEqual(
            payload["methods"],
            [method for method, _label in Payment.Method.choices],
        )
        self.assertEqual(payload["default_create_status"], Payment.Status.SETTLED)
        self.assertEqual(payload["default_create_direction"], Payment.Direction.INBOUND)
        self.assertEqual(payload["default_create_method"], Payment.Method.CHECK)
        self.assertEqual(payload["allowed_status_transitions"], expected_transitions)
        self.assertEqual(payload["terminal_statuses"], expected_terminal_statuses)
        self.assertEqual(
            payload["allocation_target_by_direction"],
            {
                Payment.Direction.INBOUND: ["invoice"],
                Payment.Direction.OUTBOUND: ["vendor_bill", "receipt"],
            },
        )
        self.assertTrue(str(payload["policy_version"]).startswith("2026-03-05.payments."))

    def test_payment_create_and_project_list(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={
                "direction": "inbound",
                "method": "ach",
                "amount": "1200.00",
                "payment_date": "2026-02-13",
                "reference_number": "DEP-2001",
                "notes": "Deposit recorded.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], "settled")
        self.assertEqual(payload["direction"], "inbound")
        self.assertEqual(payload["method"], "ach")
        self.assertEqual(payload["amount"], "1200.00")
        self.assertEqual(payload["reference_number"], "DEP-2001")

        list_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/payments/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["project"], self.project.id)
        record = PaymentRecord.objects.get(payment_id=payload["id"])
        self.assertEqual(record.event_type, PaymentRecord.EventType.CREATED)
        self.assertEqual(record.capture_source, PaymentRecord.CaptureSource.MANUAL_UI)
        self.assertIsNone(record.from_status)
        self.assertEqual(record.to_status, Payment.Status.SETTLED)
        self.assertEqual(record.recorded_by_id, self.user.id)

    def test_payment_create_with_target_updates_invoice_balance(self):
        invoice = self._create_invoice(total="500.00")
        payment_id = self._create_payment(
            status="settled", amount="300.00", direction="inbound",
            target_type="invoice", target_id=invoice.id,
        )
        invoice.refresh_from_db()
        self.assertEqual(str(invoice.balance_due), "200.00")
        self.assertEqual(invoice.status, Invoice.Status.PARTIALLY_PAID)

        payment = Payment.objects.get(id=payment_id)
        self.assertEqual(payment.target_type, Payment.TargetType.INVOICE)
        self.assertEqual(payment.invoice_id, invoice.id)

    def test_payment_create_with_target_updates_vendor_bill_balance(self):
        bill = self._create_vendor_bill(total="1000.00")
        self._create_payment(
            status="settled", amount="400.00", direction="outbound",
            target_type="vendor_bill", target_id=bill.id,
        )
        bill.refresh_from_db()
        self.assertEqual(str(bill.balance_due), "600.00")
        self.assertEqual(bill.status, VendorBill.Status.APPROVED)

    def test_payment_list_scoped_by_project_and_user(self):
        self._create_payment()
        Payment.objects.create(
            organization=self.other_org,
            project=self.other_project,
            direction=Payment.Direction.OUTBOUND,
            method=Payment.Method.CHECK,
            status=Payment.Status.SETTLED,
            amount="300.00",
            payment_date="2026-02-13",
            reference_number="CHK-9001",
            created_by=self.other_user,
        )

        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/payments/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["reference_number"], "PMT-1001")

    def test_payment_status_transition_validation(self):
        payment_id = self._create_payment(status="pending")

        to_settled = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "settled"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_settled.status_code, 200)
        self.assertEqual(to_settled.json()["data"]["status"], "settled")

        invalid = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "pending"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

        to_void = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_void.status_code, 200)
        self.assertEqual(to_void.json()["data"]["status"], "void")

    def test_payment_patch_updates_direction_method_status_reference(self):
        payment_id = self._create_payment(status="pending", direction="inbound")

        response = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={
                "direction": "outbound",
                "method": "wire",
                "status": "settled",
                "reference_number": "WIR-3001",
                "notes": "Wire confirmed by bank.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["direction"], "outbound")
        self.assertEqual(payload["method"], "wire")
        self.assertEqual(payload["status"], "settled")
        self.assertEqual(payload["reference_number"], "WIR-3001")

    def test_payment_blocks_direction_target_mismatch(self):
        """Inbound payment cannot target a vendor bill."""
        bill = self._create_vendor_bill(total="400.00")
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={
                "direction": "inbound",
                "method": "ach",
                "amount": "400.00",
                "payment_date": "2026-02-13",
                "target_type": "vendor_bill",
                "target_id": bill.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_payment_records_append_for_status_change(self):
        payment_id = self._create_payment(status="pending", amount="500.00", direction="inbound")

        to_settled = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "settled"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_settled.status_code, 200)

        events = list(
            PaymentRecord.objects.filter(payment_id=payment_id).order_by("created_at", "id")
        )
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].event_type, PaymentRecord.EventType.CREATED)
        self.assertEqual(events[1].event_type, PaymentRecord.EventType.STATUS_CHANGED)
        self.assertEqual(events[1].from_status, Payment.Status.PENDING)
        self.assertEqual(events[1].to_status, Payment.Status.SETTLED)

    def test_payment_record_is_immutable(self):
        payment_id = self._create_payment(status="pending", amount="500.00", direction="inbound")
        record = PaymentRecord.objects.filter(payment_id=payment_id).first()
        self.assertIsNotNone(record)

        record.note = "mutate"
        with self.assertRaises(ValidationError):
            record.save()
        with self.assertRaises(ValidationError):
            record.delete()

    def test_payment_validates_required_fields_and_positive_amount(self):
        missing_fields = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={"direction": "inbound"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(missing_fields.status_code, 400)
        self.assertEqual(missing_fields.json()["error"]["code"], "validation_error")

        invalid_amount = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={
                "direction": "inbound",
                "method": "cash",
                "amount": "0.00",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_amount.status_code, 400)
        self.assertIn("amount", invalid_amount.json())

    # ── Payment void reversal: system-driven status transitions ──

    def test_void_payment_reopens_fully_paid_invoice(self):
        """Voiding a payment that fully paid an invoice should revert the invoice to sent."""
        invoice = self._create_invoice(total="500.00")
        payment_id = self._create_payment(
            status="settled", amount="500.00", direction="inbound",
            target_type="invoice", target_id=invoice.id,
        )
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(str(invoice.balance_due), "0.00")

        void_resp = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(void_resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.SENT)
        self.assertEqual(str(invoice.balance_due), "500.00")

    def test_void_one_of_two_payments_reverts_paid_invoice_to_partially_paid(self):
        """Voiding one of two payments on a fully paid invoice should revert to partially_paid."""
        invoice = self._create_invoice(total="500.00")
        payment_a_id = self._create_payment(
            status="settled", amount="300.00", direction="inbound",
            target_type="invoice", target_id=invoice.id,
        )
        self._create_payment(
            status="settled", amount="200.00", direction="inbound",
            target_type="invoice", target_id=invoice.id,
        )
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(str(invoice.balance_due), "0.00")

        void_resp = self.client.patch(
            f"/api/v1/payments/{payment_a_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(void_resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.PARTIALLY_PAID)
        self.assertEqual(str(invoice.balance_due), "300.00")

    def test_void_payment_restores_vendor_bill_balance(self):
        """Voiding a payment restores the vendor bill's balance_due without changing document status."""
        bill = self._create_vendor_bill(total="1000.00", status="approved")
        payment_id = self._create_payment(
            status="settled", amount="1000.00", direction="outbound",
            target_type="vendor_bill", target_id=bill.id,
        )
        bill.refresh_from_db()
        self.assertEqual(bill.status, VendorBill.Status.APPROVED)
        self.assertEqual(str(bill.balance_due), "0.00")

        void_resp = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(void_resp.status_code, 200)
        bill.refresh_from_db()
        self.assertEqual(bill.status, VendorBill.Status.APPROVED)
        self.assertEqual(str(bill.balance_due), "1000.00")

    def test_user_cannot_manually_transition_paid_invoice_to_sent(self):
        """The paid → sent transition should only be allowed by the system, not by user API calls."""
        invoice = self._create_invoice(total="500.00", status="sent")
        invoice.status = Invoice.Status.PAID
        invoice.balance_due = 0
        invoice.save(update_fields=["status", "balance_due", "updated_at"])

        resp = self.client.patch(
            f"/api/v1/invoices/{invoice.id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("transition", resp.json()["error"]["message"].lower())

    def test_payment_amount_edit_recalculates_target_balance(self):
        """Changing a settled payment's amount should recalculate the target document's balance."""
        invoice = self._create_invoice(total="500.00")
        payment_id = self._create_payment(
            status="settled", amount="500.00", direction="inbound",
            target_type="invoice", target_id=invoice.id,
        )
        invoice.refresh_from_db()
        self.assertEqual(str(invoice.balance_due), "0.00")

        # Reduce payment amount
        resp = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"amount": "300.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resp.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(str(invoice.balance_due), "200.00")
        self.assertEqual(invoice.status, Invoice.Status.PARTIALLY_PAID)
