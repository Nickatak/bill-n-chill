from core.tests.common import *

class ProjectProfileTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm4",
            email="pm4@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm5",
            email="pm5@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

        self.customer = Customer.objects.create(
            display_name="Owner A",
            email="ownera@example.com",
            phone="555-1111",
            billing_address="1 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Basement Remodel",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            display_name="Owner B",
            email="ownerb@example.com",
            phone="555-2222",
            billing_address="2 Main St",
            created_by=self.other_user,
        )
        Project.objects.create(
            customer=other_customer,
            name="Other Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )

    def test_projects_list_requires_authentication(self):
        response = self.client.get("/api/v1/projects/")
        self.assertEqual(response.status_code, 401)

    def test_projects_list_returns_only_current_user_projects(self):
        response = self.client.get(
            "/api/v1/projects/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        projects = response.json()["data"]
        self.assertEqual(len(projects), 1)
        self.assertEqual(projects[0]["name"], "Basement Remodel")

    def test_project_patch_updates_profile_fields(self):
        response = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={
                "status": "active",
                "contract_value_current": "130000.00",
                "start_date_planned": "2026-03-01",
                "end_date_planned": "2026-07-31",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)

        self.project.refresh_from_db()
        self.assertEqual(self.project.status, Project.Status.ACTIVE)
        self.assertEqual(str(self.project.contract_value_original), "0.00")
        self.assertEqual(str(self.project.contract_value_current), "130000.00")
        self.assertEqual(str(self.project.start_date_planned), "2026-03-01")
        self.assertEqual(str(self.project.end_date_planned), "2026-07-31")

    def test_project_patch_rejects_contract_value_original_change(self):
        response = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"contract_value_original": "125000.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("contract_value_original", response.json()["error"]["fields"])

    def test_project_patch_rejects_invalid_status_transitions(self):
        invalid_from_prospect = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "completed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_from_prospect.status_code, 400)
        self.assertEqual(invalid_from_prospect.json()["error"]["code"], "validation_error")
        self.assertIn("status", invalid_from_prospect.json()["error"]["fields"])

        to_active = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_active.status_code, 200)

        to_completed = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "completed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_completed.status_code, 200)

        invalid_from_completed = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_from_completed.status_code, 400)
        self.assertEqual(invalid_from_completed.json()["error"]["code"], "validation_error")
        self.assertIn("status", invalid_from_completed.json()["error"]["fields"])

        immutable_terminal = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"name": "Renamed After Complete"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(immutable_terminal.status_code, 400)
        self.assertEqual(immutable_terminal.json()["error"]["code"], "validation_error")
        self.assertIn("status", immutable_terminal.json()["error"]["fields"])


class CostCodeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm6",
            email="pm6@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm7",
            email="pm7@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

        self.code = CostCode.objects.create(
            code="01-100",
            name="General Conditions",
            is_active=True,
            created_by=self.user,
        )
        CostCode.objects.create(
            code="02-200",
            name="Other User Code",
            is_active=True,
            created_by=self.other_user,
        )

    def test_cost_codes_list_requires_auth(self):
        response = self.client.get("/api/v1/cost-codes/")
        self.assertEqual(response.status_code, 401)

    def test_cost_codes_list_scoped_to_current_user(self):
        response = self.client.get(
            "/api/v1/cost-codes/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["code"], "01-100")

    def test_cost_code_create(self):
        response = self.client.post(
            "/api/v1/cost-codes/",
            data={"code": "03-300", "name": "Site Work", "is_active": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(CostCode.objects.filter(created_by=self.user).count(), 2)

    def test_cost_code_patch(self):
        response = self.client.patch(
            f"/api/v1/cost-codes/{self.code.id}/",
            data={"name": "General Conditions Updated", "is_active": False},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.code.refresh_from_db()
        self.assertEqual(self.code.name, "General Conditions Updated")
        self.assertFalse(self.code.is_active)


class ProjectFinancialSummaryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm22",
            email="pm22@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm23",
            email="pm23@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            display_name="Owner Summary",
            email="owner-summary@example.com",
            phone="555-8080",
            billing_address="80 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Summary Project",
            status=Project.Status.ACTIVE,
            contract_value_original="100000.00",
            contract_value_current="103000.00",
            created_by=self.user,
        )

        self.vendor = Vendor.objects.create(
            name="Summary Vendor",
            email="billing@summary-vendor.example.com",
            created_by=self.user,
        )

    def _seed_financial_records(self):
        ChangeOrder.objects.create(
            project=self.project,
            number=1,
            title="Approved CO",
            status=ChangeOrder.Status.APPROVED,
            amount_delta="2000.00",
            days_delta=1,
            requested_by=self.user,
            approved_by=self.user,
            approved_at="2026-02-15T00:00:00Z",
        )
        ChangeOrder.objects.create(
            project=self.project,
            number=2,
            title="Rejected CO",
            status=ChangeOrder.Status.REJECTED,
            amount_delta="500.00",
            days_delta=1,
            requested_by=self.user,
        )

        invoice_a = Invoice.objects.create(
            project=self.project,
            customer=self.project.customer,
            invoice_number="INV-0001",
            status=Invoice.Status.SENT,
            issue_date="2026-02-13",
            due_date="2026-03-13",
            subtotal="1200.00",
            total="1200.00",
            balance_due="1200.00",
            created_by=self.user,
        )
        Invoice.objects.create(
            project=self.project,
            customer=self.project.customer,
            invoice_number="INV-0002",
            status=Invoice.Status.VOID,
            issue_date="2026-02-13",
            due_date="2026-03-13",
            subtotal="500.00",
            total="500.00",
            balance_due="500.00",
            created_by=self.user,
        )

        bill_a = VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="B-1001",
            status=VendorBill.Status.SCHEDULED,
            issue_date="2026-02-13",
            due_date="2026-03-13",
            total="900.00",
            balance_due="900.00",
            created_by=self.user,
        )
        VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="B-1002",
            status=VendorBill.Status.VOID,
            issue_date="2026-02-13",
            due_date="2026-03-13",
            total="300.00",
            balance_due="300.00",
            created_by=self.user,
        )

        inbound_payment = Payment.objects.create(
            project=self.project,
            direction=Payment.Direction.INBOUND,
            method=Payment.Method.ACH,
            status=Payment.Status.SETTLED,
            amount="1000.00",
            payment_date="2026-02-15",
            created_by=self.user,
        )
        outbound_payment = Payment.objects.create(
            project=self.project,
            direction=Payment.Direction.OUTBOUND,
            method=Payment.Method.CHECK,
            status=Payment.Status.SETTLED,
            amount="700.00",
            payment_date="2026-02-15",
            created_by=self.user,
        )

        PaymentAllocation.objects.create(
            payment=inbound_payment,
            target_type="invoice",
            invoice=invoice_a,
            applied_amount="800.00",
            created_by=self.user,
        )
        PaymentAllocation.objects.create(
            payment=outbound_payment,
            target_type="vendor_bill",
            vendor_bill=bill_a,
            applied_amount="400.00",
            created_by=self.user,
        )

    def test_project_financial_summary_returns_expected_metrics(self):
        self._seed_financial_records()

        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/financial-summary/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["contract_value_original"], "100000.00")
        self.assertEqual(data["contract_value_current"], "103000.00")
        self.assertEqual(data["approved_change_orders_total"], "2000.00")
        self.assertEqual(data["invoiced_to_date"], "1200.00")
        self.assertEqual(data["paid_to_date"], "800.00")
        self.assertEqual(data["ar_outstanding"], "400.00")
        self.assertEqual(data["ap_total"], "900.00")
        self.assertEqual(data["ap_paid"], "400.00")
        self.assertEqual(data["ap_outstanding"], "500.00")
        self.assertEqual(data["inbound_unapplied_credit"], "200.00")
        self.assertEqual(data["outbound_unapplied_credit"], "300.00")
        self.assertIn("traceability", data)
        self.assertEqual(data["traceability"]["approved_change_orders"]["ui_route"], "/change-orders")
        self.assertEqual(data["traceability"]["ar_invoices"]["ui_route"], "/invoices")
        self.assertEqual(data["traceability"]["ar_payments"]["ui_route"], "/payments")
        self.assertEqual(data["traceability"]["ap_vendor_bills"]["ui_route"], "/vendor-bills")
        self.assertEqual(data["traceability"]["ap_payments"]["ui_route"], "/payments")
        self.assertEqual(data["traceability"]["approved_change_orders"]["total"], "2000.00")
        self.assertEqual(data["traceability"]["ar_invoices"]["total"], "1200.00")
        self.assertEqual(data["traceability"]["ar_payments"]["total"], "800.00")
        self.assertEqual(data["traceability"]["ap_vendor_bills"]["total"], "900.00")
        self.assertEqual(data["traceability"]["ap_payments"]["total"], "400.00")
        self.assertEqual(len(data["traceability"]["approved_change_orders"]["records"]), 1)
        self.assertEqual(len(data["traceability"]["ar_invoices"]["records"]), 1)
        self.assertEqual(len(data["traceability"]["ar_payments"]["records"]), 1)
        self.assertEqual(len(data["traceability"]["ap_vendor_bills"]["records"]), 1)
        self.assertEqual(len(data["traceability"]["ap_payments"]["records"]), 1)

    def test_project_accounting_export_json_and_csv_match_summary_totals(self):
        self._seed_financial_records()

        summary_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/financial-summary/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(summary_response.status_code, 200)
        summary = summary_response.json()["data"]

        export_json_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/accounting-export/?export_format=json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(export_json_response.status_code, 200)
        export_json = export_json_response.json()["data"]
        self.assertEqual(export_json["summary"]["invoiced_to_date"], summary["invoiced_to_date"])
        self.assertEqual(export_json["summary"]["paid_to_date"], summary["paid_to_date"])
        self.assertEqual(export_json["summary"]["ap_total"], summary["ap_total"])
        self.assertEqual(export_json["summary"]["ap_paid"], summary["ap_paid"])

        export_csv_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/accounting-export/?export_format=csv",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(export_csv_response.status_code, 200)
        self.assertEqual(export_csv_response["Content-Type"], "text/csv")
        csv_text = export_csv_response.content.decode("utf-8")
        self.assertIn("row_type,section,metric,record_id,label,status,amount,endpoint", csv_text)
        self.assertIn("summary,summary,invoiced_to_date,,,,1200.00,", csv_text)
        self.assertIn("record,ar_invoices,,", csv_text)
        self.assertIn("/api/v1/invoices/", csv_text)

    def test_project_financial_summary_scoped_and_requires_auth(self):
        no_auth = self.client.get(f"/api/v1/projects/{self.project.id}/financial-summary/")
        self.assertEqual(no_auth.status_code, 401)

        other_customer = Customer.objects.create(
            display_name="Other Owner",
            email="other-owner@example.com",
            phone="555-9090",
            billing_address="90 Main St",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            customer=other_customer,
            name="Other Summary Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )

        hidden = self.client.get(
            f"/api/v1/projects/{other_project.id}/financial-summary/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(hidden.status_code, 404)
