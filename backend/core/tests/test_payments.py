from unittest.mock import patch

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
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            display_name="Owner M",
            email="ownerm@example.com",
            phone="555-4040",
            billing_address="13 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Payment Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            display_name="Owner N",
            email="ownern@example.com",
            phone="555-5050",
            billing_address="14 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            customer=other_customer,
            name="Other Payment Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )

    def _create_payment(self, *, status="pending", amount="800.00", direction="inbound"):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/payments/",
            data={
                "direction": direction,
                "method": "ach",
                "status": status,
                "amount": amount,
                "payment_date": "2026-02-13",
                "reference_number": "PMT-1001",
                "notes": "Initial payment entry.",
            },
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

    def _create_vendor_bill(self, *, total="1000.00", status="scheduled"):
        vendor = Vendor.objects.create(
            name=f"Vendor {Vendor.objects.filter(created_by=self.user).count() + 1}",
            email=f"vendor{Vendor.objects.filter(created_by=self.user).count() + 1}@example.com",
            created_by=self.user,
        )
        return VendorBill.objects.create(
            project=self.project,
            vendor=vendor,
            bill_number=f"B-{VendorBill.objects.filter(project=self.project).count() + 1000}",
            status=status,
            issue_date="2026-02-13",
            due_date="2026-03-15",
            scheduled_for="2026-02-25" if status == VendorBill.Status.SCHEDULED else None,
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
        self.assertEqual(payload["default_create_status"], Payment.Status.PENDING)
        self.assertEqual(payload["default_create_direction"], Payment.Direction.INBOUND)
        self.assertEqual(payload["default_create_method"], Payment.Method.ACH)
        self.assertEqual(payload["allowed_status_transitions"], expected_transitions)
        self.assertEqual(payload["terminal_statuses"], expected_terminal_statuses)
        self.assertEqual(
            payload["allocation_target_by_direction"],
            {
                Payment.Direction.INBOUND: "invoice",
                Payment.Direction.OUTBOUND: "vendor_bill",
            },
        )
        self.assertTrue(str(payload["policy_version"]).startswith("2026-02-23.payments."))

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
        self.assertEqual(payload["status"], "pending")
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
        self.assertEqual(record.to_status, Payment.Status.PENDING)
        self.assertEqual(record.recorded_by_id, self.user.id)

    def test_payment_list_scoped_by_project_and_user(self):
        self._create_payment()
        Payment.objects.create(
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

    def test_payment_failed_only_transitions_to_void_and_void_is_terminal(self):
        payment_id = self._create_payment(status="pending")

        to_failed = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "failed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_failed.status_code, 200)
        self.assertEqual(to_failed.json()["data"]["status"], "failed")

        failed_to_pending = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "pending"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(failed_to_pending.status_code, 400)
        self.assertEqual(failed_to_pending.json()["error"]["code"], "validation_error")

        failed_to_settled = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "settled"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(failed_to_settled.status_code, 400)
        self.assertEqual(failed_to_settled.json()["error"]["code"], "validation_error")

        to_void = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_void.status_code, 200)
        self.assertEqual(to_void.json()["data"]["status"], "void")

        void_to_pending = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "pending"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(void_to_pending.status_code, 400)
        self.assertEqual(void_to_pending.json()["error"]["code"], "validation_error")

    def test_payment_patch_updates_direction_method_status_reference(self):
        payment_id = self._create_payment(status="pending", direction="inbound")

        response = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={
                "direction": "outbound",
                "method": "wire",
                "status": "failed",
                "reference_number": "WIR-3001",
                "notes": "Wire rejected by bank.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["direction"], "outbound")
        self.assertEqual(payload["method"], "wire")
        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["reference_number"], "WIR-3001")

    def test_payment_allocation_inbound_partial_updates_invoice_balances(self):
        payment_id = self._create_payment(status="settled", amount="900.00", direction="inbound")
        invoice_a = self._create_invoice(total="500.00")
        invoice_b = self._create_invoice(total="600.00")

        response = self.client.post(
            f"/api/v1/payments/{payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice_a.id, "applied_amount": "300.00"},
                    {"target_type": "invoice", "target_id": invoice_b.id, "applied_amount": "500.00"},
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)

        invoice_a.refresh_from_db()
        invoice_b.refresh_from_db()
        self.assertEqual(str(invoice_a.balance_due), "200.00")
        self.assertEqual(invoice_a.status, Invoice.Status.PARTIALLY_PAID)
        self.assertEqual(str(invoice_b.balance_due), "100.00")
        self.assertEqual(invoice_b.status, Invoice.Status.PARTIALLY_PAID)

        payload = response.json()
        self.assertEqual(payload["meta"]["allocated_total"], "800.00")
        self.assertEqual(payload["meta"]["unapplied_amount"], "100.00")
        self.assertEqual(len(payload["data"]["created_allocations"]), 2)

    def test_payment_allocation_outbound_partial_updates_vendor_bill_balances(self):
        payment_id = self._create_payment(status="settled", amount="700.00", direction="outbound")
        bill_a = self._create_vendor_bill(total="300.00")
        bill_b = self._create_vendor_bill(total="600.00")

        response = self.client.post(
            f"/api/v1/payments/{payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "vendor_bill", "target_id": bill_a.id, "applied_amount": "300.00"},
                    {"target_type": "vendor_bill", "target_id": bill_b.id, "applied_amount": "200.00"},
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)

        bill_a.refresh_from_db()
        bill_b.refresh_from_db()
        self.assertEqual(str(bill_a.balance_due), "0.00")
        self.assertEqual(bill_a.status, VendorBill.Status.PAID)
        self.assertEqual(str(bill_b.balance_due), "400.00")

    def test_payment_allocation_blocks_direction_mismatch_and_overallocation(self):
        inbound_payment_id = self._create_payment(status="settled", amount="400.00", direction="inbound")
        vendor_bill = self._create_vendor_bill(total="400.00")
        invoice = self._create_invoice(total="500.00")

        mismatch = self.client.post(
            f"/api/v1/payments/{inbound_payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "vendor_bill", "target_id": vendor_bill.id, "applied_amount": "100.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(mismatch.status_code, 400)
        self.assertEqual(mismatch.json()["error"]["code"], "validation_error")

        over = self.client.post(
            f"/api/v1/payments/{inbound_payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice.id, "applied_amount": "500.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(over.status_code, 400)
        self.assertEqual(over.json()["error"]["code"], "validation_error")

    def test_payment_allocation_requires_settled_and_reverses_on_void(self):
        payment_id = self._create_payment(status="pending", amount="500.00", direction="inbound")
        invoice = self._create_invoice(total="500.00")

        blocked = self.client.post(
            f"/api/v1/payments/{payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice.id, "applied_amount": "200.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.json()["error"]["code"], "validation_error")

        to_settled = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "settled"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_settled.status_code, 200)

        created = self.client.post(
            f"/api/v1/payments/{payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice.id, "applied_amount": "200.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(created.status_code, 201)
        invoice.refresh_from_db()
        self.assertEqual(str(invoice.balance_due), "300.00")

        to_void = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_void.status_code, 200)
        invoice.refresh_from_db()
        self.assertEqual(str(invoice.balance_due), "500.00")

    def test_payment_records_append_for_status_change_and_allocation(self):
        payment_id = self._create_payment(status="pending", amount="500.00", direction="inbound")
        invoice = self._create_invoice(total="500.00")

        to_settled = self.client.patch(
            f"/api/v1/payments/{payment_id}/",
            data={"status": "settled"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_settled.status_code, 200)

        created = self.client.post(
            f"/api/v1/payments/{payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice.id, "applied_amount": "200.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(created.status_code, 201)

        events = list(
            PaymentRecord.objects.filter(payment_id=payment_id).order_by("created_at", "id")
        )
        self.assertEqual(len(events), 3)
        self.assertEqual(events[0].event_type, PaymentRecord.EventType.CREATED)
        self.assertEqual(events[1].event_type, PaymentRecord.EventType.STATUS_CHANGED)
        self.assertEqual(events[1].from_status, Payment.Status.PENDING)
        self.assertEqual(events[1].to_status, Payment.Status.SETTLED)
        self.assertEqual(events[2].event_type, PaymentRecord.EventType.ALLOCATION_APPLIED)
        self.assertEqual(events[2].capture_source, PaymentRecord.CaptureSource.MANUAL_UI)
        self.assertEqual(events[2].metadata_json["allocation_count"], 1)
        self.assertEqual(events[2].metadata_json["allocations"][0]["target_type"], "invoice")
        self.assertEqual(events[2].metadata_json["allocations"][0]["target_id"], invoice.id)
        self.assertEqual(events[2].metadata_json["allocations"][0]["applied_amount"], "200.00")
        self.assertIn("payment_allocation_id", events[2].metadata_json["allocations"][0])

        allocation_events = list(
            PaymentAllocationRecord.objects.filter(payment_id=payment_id).order_by("created_at", "id")
        )
        self.assertEqual(len(allocation_events), 1)
        self.assertEqual(allocation_events[0].event_type, PaymentAllocationRecord.EventType.APPLIED)
        self.assertEqual(
            allocation_events[0].capture_source,
            PaymentAllocationRecord.CaptureSource.MANUAL_UI,
        )
        self.assertEqual(allocation_events[0].recorded_by_id, self.user.id)
        self.assertEqual(allocation_events[0].target_type, PaymentAllocationRecord.TargetType.INVOICE)
        self.assertEqual(allocation_events[0].target_object_id, invoice.id)
        self.assertEqual(str(allocation_events[0].applied_amount), "200.00")
        self.assertEqual(
            allocation_events[0].snapshot_json["allocation"]["id"],
            allocation_events[0].payment_allocation_id,
        )
        self.assertEqual(allocation_events[0].snapshot_json["allocation"]["invoice_id"], invoice.id)

    def test_payment_record_is_immutable(self):
        payment_id = self._create_payment(status="pending", amount="500.00", direction="inbound")
        record = PaymentRecord.objects.filter(payment_id=payment_id).first()
        self.assertIsNotNone(record)

        record.note = "mutate"
        with self.assertRaises(ValidationError):
            record.save()
        with self.assertRaises(ValidationError):
            record.delete()

    def test_payment_allocation_record_is_immutable(self):
        payment_id = self._create_payment(status="settled", amount="500.00", direction="inbound")
        invoice = self._create_invoice(total="500.00")

        response = self.client.post(
            f"/api/v1/payments/{payment_id}/allocate/",
            data={
                "allocations": [
                    {"target_type": "invoice", "target_id": invoice.id, "applied_amount": "200.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)

        record = PaymentAllocationRecord.objects.filter(payment_id=payment_id).first()
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

    def test_payment_create_rolls_back_when_audit_write_fails(self):
        with patch(
            "core.models.financial_auditing.financial_audit_event.FinancialAuditEvent.record",
            side_effect=RuntimeError("audit-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    f"/api/v1/projects/{self.project.id}/payments/",
                    data={
                        "direction": "inbound",
                        "method": "ach",
                        "amount": "1200.00",
                        "payment_date": "2026-02-13",
                        "reference_number": "DEP-ROLLBACK",
                        "notes": "Atomic rollback test.",
                    },
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertFalse(
            Payment.objects.filter(project=self.project, reference_number="DEP-ROLLBACK").exists()
        )
        self.assertFalse(PaymentRecord.objects.filter(note="Payment created.").exists())
