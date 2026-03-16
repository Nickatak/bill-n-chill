from datetime import timedelta

from django.core.exceptions import ValidationError
from core.tests.common import *
from django.utils import timezone

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
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner A",
            email="ownera@example.com",
            phone="555-1111",
            billing_address="1 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Basement Remodel",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Owner B",
            email="ownerb@example.com",
            phone="555-2222",
            billing_address="2 Main St",
            created_by=self.other_user,
        )
        Project.objects.create(
            organization=self.other_org,
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
        self.assertIn("site_address", projects[0])
        self.assertEqual(projects[0]["accepted_contract_total"], "0.00")

    def test_projects_list_includes_rows_created_by_other_user_in_same_org(self):
        """Projects in the same org are visible regardless of who created them."""
        # Move the other user's project and customer into the same org
        other_customer = self.project.customer  # just need the other project's customer
        other_project = Project.objects.filter(name="Other Project").first()
        other_project.organization = self.org
        other_project.save(update_fields=["organization_id"])
        other_project.customer.organization = self.org
        other_project.customer.save(update_fields=["organization_id"])

        response = self.client.get(
            "/api/v1/projects/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        projects = response.json()["data"]
        names = {row["name"] for row in projects}
        self.assertIn("Basement Remodel", names)
        self.assertIn("Other Project", names)

    def test_project_patch_updates_profile_fields(self):
        response = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={
                "status": "active",
                "site_address": "7 Job Site Ln",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)

        self.project.refresh_from_db()
        self.assertEqual(self.project.status, Project.Status.ACTIVE)
        self.assertEqual(self.project.site_address, "7 Job Site Ln")
        self.assertEqual(str(self.project.contract_value_original), "0.00")
        self.assertEqual(str(self.project.contract_value_current), "0.00")

    def test_project_patch_returns_not_found_for_other_users_project(self):
        other_project = Project.objects.exclude(created_by=self.user).first()
        response = self.client.patch(
            f"/api/v1/projects/{other_project.id}/",
            data={"name": "Should Not Update"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 404)

    def test_project_patch_site_address_does_not_modify_customer_billing_address(self):
        original_billing_address = self.customer.billing_address
        response = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"site_address": "55 Jobsite Way"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.customer.refresh_from_db()
        self.assertEqual(self.project.site_address, "55 Jobsite Way")
        self.assertEqual(self.customer.billing_address, original_billing_address)

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

    def test_project_patch_rejects_contract_value_current_change(self):
        response = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"contract_value_current": "125000.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("contract_value_current", response.json()["error"]["fields"])

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

    def test_project_patch_allows_active_on_hold_round_trip(self):
        to_active = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_active.status_code, 200)

        to_on_hold = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "on_hold"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_on_hold.status_code, 200)

        back_to_active = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(back_to_active.status_code, 200)

    def test_project_patch_rejects_noop_same_status_without_other_changes(self):
        to_active = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_active.status_code, 200)

        noop_status = self.client.patch(
            f"/api/v1/projects/{self.project.id}/",
            data={"status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(noop_status.status_code, 400)
        payload = noop_status.json()["error"]
        self.assertEqual(payload["code"], "validation_error")
        self.assertIn("status", payload["fields"])

    # test_project_patch_rejects_end_date_before_start_date removed:
    # start_date_planned / end_date_planned fields were intentionally removed from
    # the Project model. Date validation is no longer applicable.


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
        self.user_org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)

        self.code, _ = CostCode.objects.get_or_create(
            code="01-100",
            organization=self.user_org,
            defaults={
                "name": "General Conditions",
                "is_active": True,
                "created_by": self.user,
            },
        )
        CostCode.objects.get_or_create(
            code="02-200",
            organization=self.other_org,
            defaults={
                "name": "Other User Code",
                "is_active": True,
                "created_by": self.other_user,
            },
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
        codes = {row["code"] for row in rows}
        self.assertIn("01-100", codes)
        # Should not include codes from other org
        self.assertNotIn("02-200", codes)

    def test_cost_codes_list_includes_rows_created_by_other_user_in_same_org(self):
        shared_org = Organization.objects.create(
            display_name="Shared Org",
            created_by=self.user,
        )
        OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        OrganizationMembership.objects.update_or_create(
            user=self.other_user,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.PM,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        self.code.organization = shared_org
        self.code.save(update_fields=["organization"])

        shared_org_code = CostCode.objects.create(
            code="03-300",
            name="Shared Org Code",
            is_active=True,
            organization=shared_org,
            created_by=self.other_user,
        )
        other_isolated_org = Organization.objects.create(
            display_name="Isolated Org",
            created_by=self.other_user,
        )
        isolated_org_code = CostCode.objects.create(
            code="04-400",
            name="Isolated Org Code",
            is_active=True,
            organization=other_isolated_org,
            created_by=self.other_user,
        )

        response = self.client.get(
            "/api/v1/cost-codes/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        returned_ids = {row["id"] for row in rows}
        self.assertIn(self.code.id, returned_ids)
        self.assertIn(shared_org_code.id, returned_ids)
        self.assertNotIn(isolated_org_code.id, returned_ids)

    def test_cost_code_create(self):
        membership = OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": Organization.objects.create(
                    display_name="Cost Code Org",
                    created_by=self.user,
                ),
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )[0]
        response = self.client.post(
            "/api/v1/cost-codes/",
            data={"code": "03-300", "name": "Site Work"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        created_code = CostCode.objects.get(id=response.json()["data"]["id"])
        self.assertEqual(created_code.organization_id, membership.organization_id)
        self.assertTrue(created_code.is_active)
        self.assertEqual(
            CostCode.objects.filter(organization_id=membership.organization_id, code="03-300").count(), 1
        )

    def test_cost_code_create_rejects_inactive(self):
        response = self.client.post(
            "/api/v1/cost-codes/",
            data={"code": "03-300", "name": "Site Work", "is_active": False},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("is_active", payload)
        self.assertFalse(CostCode.objects.filter(organization=self.user_org, code="03-300").exists())

    def test_cost_code_create_rejects_duplicate_code_in_same_org(self):
        response = self.client.post(
            "/api/v1/cost-codes/",
            data={"code": "01-100", "name": "Duplicate General Conditions", "is_active": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("code", payload["error"]["fields"])
        self.assertEqual(CostCode.objects.filter(organization=self.user_org, code="01-100").count(), 1)

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
        self.assertEqual(self.code.code, "01-100")

    def test_cost_code_patch_rejects_code_change(self):
        response = self.client.patch(
            f"/api/v1/cost-codes/{self.code.id}/",
            data={"code": "99-999"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("code", payload["error"]["fields"])
        self.code.refresh_from_db()
        self.assertEqual(self.code.code, "01-100")

    def test_cost_code_delete_is_blocked_by_policy(self):
        with self.assertRaises(ValidationError):
            self.code.delete()
        self.assertTrue(CostCode.objects.filter(id=self.code.id).exists())

    def test_cost_code_queryset_delete_is_blocked_by_policy(self):
        with self.assertRaises(ValidationError):
            CostCode.objects.filter(id=self.code.id).delete()
        self.assertTrue(CostCode.objects.filter(id=self.code.id).exists())

    def test_cost_code_csv_import_preview_and_apply(self):
        preview = self.client.post(
            "/api/v1/cost-codes/import-csv/",
            data={
                "dry_run": True,
                "csv_text": "code,name\n01-100,General Conditions Updated\n03-300,Site Work\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(preview.status_code, 200)
        preview_data = preview.json()["data"]
        self.assertEqual(preview_data["mode"], "preview")
        self.assertEqual(preview_data["total_rows"], 2)
        # Preview should not create any new codes
        self.assertFalse(CostCode.objects.filter(organization=self.user_org, code="03-300").exists())

        apply_response = self.client.post(
            "/api/v1/cost-codes/import-csv/",
            data={
                "dry_run": False,
                "csv_text": "code,name\n01-100,General Conditions Updated\n03-300,Site Work\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(apply_response.status_code, 200)
        data = apply_response.json()["data"]
        self.assertEqual(data["updated_count"], 1)
        self.assertEqual(data["created_count"], 1)
        self.assertTrue(CostCode.objects.filter(organization=self.user_org, code="03-300").exists())
        self.code.refresh_from_db()
        self.assertEqual(self.code.name, "General Conditions Updated")
        self.assertTrue(self.code.is_active)
        self.assertTrue(
            CostCode.objects.filter(
                created_by=self.user,
                code="03-300",
                name="Site Work",
                is_active=True,
            ).exists()
        )

    def test_cost_code_csv_import_applies_when_dry_run_string_false(self):
        response = self.client.post(
            "/api/v1/cost-codes/import-csv/",
            data={
                "dry_run": "false",
                "csv_text": "code,name\n03-300,Site Work\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["mode"], "apply")
        self.assertEqual(payload["created_count"], 1)
        self.assertTrue(
            CostCode.objects.filter(created_by=self.user, code="03-300", name="Site Work").exists()
        )

    def test_cost_code_csv_import_rejects_is_active_header(self):
        response = self.client.post(
            "/api/v1/cost-codes/import-csv/",
            data={
                "dry_run": True,
                "csv_text": "code,name,is_active\n03-300,Site Work,true\n",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("headers", payload["error"]["fields"])


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
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner Summary",
            email="owner-summary@example.com",
            phone="555-8080",
            billing_address="80 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
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
            organization=self.org,
        )

    def _seed_financial_records(self):
        ChangeOrder.objects.create(
            project=self.project,
            family_key="1",
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
            family_key="2",
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
            scheduled_for="2026-02-20",
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
            organization=self.org,
            project=self.project,
            direction=Payment.Direction.INBOUND,
            method=Payment.Method.ACH,
            status=Payment.Status.SETTLED,
            amount="1000.00",
            payment_date="2026-02-15",
            created_by=self.user,
        )
        outbound_payment = Payment.objects.create(
            organization=self.org,
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
        self.assertEqual(data["accepted_contract_total"], "2000.00")
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
        self.assertEqual(data["traceability"]["ar_invoices"]["ui_route"], f"/projects/{self.project.id}/invoices")
        self.assertEqual(
            data["traceability"]["ar_payments"]["ui_route"],
            "/payments",
        )
        self.assertEqual(data["traceability"]["ap_vendor_bills"]["ui_route"], "/vendor-bills")
        self.assertEqual(
            data["traceability"]["ap_payments"]["ui_route"],
            "/payments",
        )
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

    def test_project_financial_summary_accepted_contract_total_is_zero_without_approved_docs(self):
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/financial-summary/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["contract_value_original"], "100000.00")
        self.assertEqual(data["contract_value_current"], "103000.00")
        self.assertEqual(data["accepted_contract_total"], "0.00")

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
            organization=self.other_org,
            display_name="Other Owner",
            email="other-owner@example.com",
            phone="555-9090",
            billing_address="90 Main St",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
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


class ReportingPackTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm24",
            email="pm24@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm25",
            email="pm25@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner Reporting",
            email="owner-reporting@example.com",
            phone="555-8181",
            billing_address="81 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Reporting Active Project",
            status=Project.Status.ACTIVE,
            contract_value_original="10000.00",
            contract_value_current="10800.00",
            created_by=self.user,
        )
        self.project_prospect = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Reporting Prospect Project",
            status=Project.Status.PROSPECT,
            contract_value_original="5000.00",
            contract_value_current="5000.00",
            created_by=self.user,
        )
        self.vendor = Vendor.objects.create(
            name="Reporting Vendor",
            email="billing@reporting-vendor.example.com",
            created_by=self.user,
            organization=self.org,
        )

    def _seed_reporting_records(self):
        ChangeOrder.objects.create(
            project=self.project,
            family_key="1",
            title="Approved CO 1",
            status=ChangeOrder.Status.APPROVED,
            amount_delta="300.00",
            days_delta=1,
            requested_by=self.user,
            approved_by=self.user,
            approved_at="2026-02-10T00:00:00Z",
        )
        ChangeOrder.objects.create(
            project=self.project,
            family_key="2",
            title="Approved CO 2",
            status=ChangeOrder.Status.APPROVED,
            amount_delta="500.00",
            days_delta=1,
            requested_by=self.user,
            approved_by=self.user,
            approved_at="2026-03-10T00:00:00Z",
        )

        Invoice.objects.create(
            project=self.project,
            customer=self.project.customer,
            invoice_number="INV-RPT-1",
            status=Invoice.Status.SENT,
            issue_date="2026-02-01",
            due_date="2026-02-15",
            subtotal="400.00",
            total="400.00",
            balance_due="400.00",
            created_by=self.user,
        )
        Invoice.objects.create(
            project=self.project,
            customer=self.project.customer,
            invoice_number="INV-RPT-2",
            status=Invoice.Status.PAID,
            issue_date="2026-02-01",
            due_date="2026-03-01",
            subtotal="600.00",
            total="600.00",
            balance_due="0.00",
            created_by=self.user,
        )

        VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="VB-RPT-1",
            status=VendorBill.Status.RECEIVED,
            issue_date="2026-02-01",
            due_date="2026-02-20",
            total="250.00",
            balance_due="250.00",
            created_by=self.user,
        )
        VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="VB-RPT-2",
            status=VendorBill.Status.PAID,
            issue_date="2026-02-01",
            due_date="2026-03-20",
            total="100.00",
            balance_due="0.00",
            created_by=self.user,
        )

    def test_portfolio_snapshot_reports_rollups(self):
        self._seed_reporting_records()

        response = self.client.get(
            "/api/v1/reports/portfolio/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["active_projects_count"], 1)
        self.assertEqual(data["ar_total_outstanding"], "1000.00")
        self.assertEqual(data["ap_total_outstanding"], "350.00")
        self.assertEqual(data["overdue_invoice_count"], 1)
        self.assertEqual(data["overdue_vendor_bill_count"], 1)
        self.assertEqual(len(data["projects"]), 2)

    def test_change_impact_summary_supports_date_filters(self):
        self._seed_reporting_records()

        all_rows = self.client.get(
            "/api/v1/reports/change-impact/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(all_rows.status_code, 200)
        all_data = all_rows.json()["data"]
        self.assertEqual(all_data["approved_change_order_count"], 2)
        self.assertEqual(all_data["approved_change_order_total"], "800.00")
        self.assertEqual(len(all_data["projects"]), 1)

        filtered = self.client.get(
            "/api/v1/reports/change-impact/?date_from=2026-03-01&date_to=2026-03-31",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(filtered.status_code, 200)
        filtered_data = filtered.json()["data"]
        self.assertEqual(filtered_data["approved_change_order_count"], 1)
        self.assertEqual(filtered_data["approved_change_order_total"], "500.00")

    def test_reporting_endpoints_validate_dates_and_scope_to_user(self):
        invalid = self.client.get(
            "/api/v1/reports/portfolio/?date_from=2026-03-20&date_to=2026-03-01",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

        invalid_format = self.client.get(
            "/api/v1/reports/change-impact/?date_from=03-01-2026",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_format.status_code, 400)
        self.assertEqual(invalid_format.json()["error"]["code"], "validation_error")

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Reporting Owner",
            email="other-reporting-owner@example.com",
            phone="555-9191",
            billing_address="91 Main St",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other User Project",
            status=Project.Status.ACTIVE,
            contract_value_original="1000.00",
            contract_value_current="1200.00",
            created_by=self.other_user,
        )
        ChangeOrder.objects.create(
            project=other_project,
            family_key="1",
            title="Other User CO",
            status=ChangeOrder.Status.APPROVED,
            amount_delta="999.00",
            days_delta=1,
            requested_by=self.other_user,
            approved_by=self.other_user,
            approved_at="2026-02-10T00:00:00Z",
        )

        scoped = self.client.get(
            "/api/v1/reports/change-impact/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(scoped.status_code, 200)
        scoped_data = scoped.json()["data"]
        self.assertEqual(scoped_data["approved_change_order_total"], "0.00")

    def test_attention_feed_returns_actionable_items(self):
        today = timezone.localdate()
        invoice_issue_date = today - timedelta(days=2)
        overdue_due_date = today - timedelta(days=1)
        due_soon_date = today + timedelta(days=4)
        Invoice.objects.create(
            project=self.project,
            customer=self.project.customer,
            invoice_number="INV-ATTN-1",
            status=Invoice.Status.SENT,
            issue_date=invoice_issue_date,
            due_date=overdue_due_date,
            subtotal="250.00",
            total="250.00",
            balance_due="250.00",
            created_by=self.user,
        )
        VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="VB-ATTN-1",
            status=VendorBill.Status.RECEIVED,
            issue_date=today,
            due_date=due_soon_date,
            total="180.00",
            balance_due="180.00",
            created_by=self.user,
        )
        ChangeOrder.objects.create(
            project=self.project,
            family_key="21",
            title="Pending Approval CO",
            status=ChangeOrder.Status.PENDING_APPROVAL,
            amount_delta="90.00",
            days_delta=1,
            requested_by=self.user,
        )
        Payment.objects.create(
            organization=self.org,
            project=self.project,
            direction=Payment.Direction.INBOUND,
            method=Payment.Method.ACH,
            status=Payment.Status.VOID,
            amount="120.00",
            payment_date=today,
            created_by=self.user,
        )

        response = self.client.get(
            "/api/v1/reports/attention-feed/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["due_soon_window_days"], 7)
        self.assertEqual(data["item_count"], 4)
        kinds = {item["kind"] for item in data["items"]}
        self.assertIn("overdue_invoice", kinds)
        self.assertIn("vendor_bill_due_soon", kinds)
        self.assertIn("change_order_pending_approval", kinds)
        self.assertIn("payment_problem", kinds)

    def test_quick_jump_search_returns_cross_entity_results(self):
        self.project.name = "Kitchen Main Project"
        self.project.save(update_fields=["name", "updated_at"])
        estimate = Estimate.objects.create(
            project=self.project,
            version=1,
            status=Estimate.Status.DRAFT,
            title="Kitchen Scope",
            created_by=self.user,
        )
        change_order = ChangeOrder.objects.create(
            project=self.project,
            family_key="5",
            title="Kitchen Delta",
            status=ChangeOrder.Status.PENDING_APPROVAL,
            amount_delta="250.00",
            days_delta=1,
            requested_by=self.user,
        )
        invoice = Invoice.objects.create(
            project=self.project,
            customer=self.project.customer,
            invoice_number="INV-KITCHEN-1",
            status=Invoice.Status.DRAFT,
            issue_date=timezone.localdate(),
            due_date=timezone.localdate(),
            subtotal="100.00",
            total="100.00",
            balance_due="100.00",
            created_by=self.user,
        )
        vendor_bill = VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="VB-KITCHEN-1",
            status=VendorBill.Status.PLANNED,
            issue_date=timezone.localdate(),
            due_date=timezone.localdate(),
            total="80.00",
            balance_due="80.00",
            created_by=self.user,
        )
        payment = Payment.objects.create(
            organization=self.org,
            project=self.project,
            direction=Payment.Direction.INBOUND,
            method=Payment.Method.ACH,
            status=Payment.Status.PENDING,
            amount="75.00",
            payment_date=timezone.localdate(),
            reference_number="KITCHEN-PAY",
            created_by=self.user,
        )

        response = self.client.get(
            "/api/v1/search/quick-jump/?q=kitchen",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertGreaterEqual(data["item_count"], 6)
        kinds = {item["kind"] for item in data["items"]}
        self.assertIn("project", kinds)
        self.assertIn("estimate", kinds)
        self.assertIn("change_order", kinds)
        self.assertIn("invoice", kinds)
        self.assertIn("vendor_bill", kinds)
        self.assertIn("payment", kinds)
        endpoints = {item["detail_endpoint"] for item in data["items"]}
        self.assertIn(f"/api/v1/estimates/{estimate.id}/", endpoints)
        self.assertIn(f"/api/v1/change-orders/{change_order.id}/", endpoints)
        self.assertIn(f"/api/v1/invoices/{invoice.id}/", endpoints)
        self.assertIn(f"/api/v1/vendor-bills/{vendor_bill.id}/", endpoints)
        self.assertIn(f"/api/v1/payments/{payment.id}/", endpoints)

    def test_quick_jump_search_minimum_query_and_scope(self):
        short_response = self.client.get(
            "/api/v1/search/quick-jump/?q=a",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(short_response.status_code, 200)
        short_data = short_response.json()["data"]
        self.assertEqual(short_data["item_count"], 0)
        self.assertEqual(short_data["items"], [])

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Search Owner",
            email="other-search-owner@example.com",
            phone="555-9292",
            billing_address="92 Main St",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Kitchen Project",
            status=Project.Status.ACTIVE,
            contract_value_original="1000.00",
            contract_value_current="1000.00",
            created_by=self.other_user,
        )
        Estimate.objects.create(
            project=other_project,
            version=1,
            status=Estimate.Status.DRAFT,
            title="Other Kitchen Scope",
            created_by=self.other_user,
        )

        scoped_response = self.client.get(
            "/api/v1/search/quick-jump/?q=other",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(scoped_response.status_code, 200)
        scoped_data = scoped_response.json()["data"]
        self.assertEqual(scoped_data["item_count"], 0)


class ProjectTimelineTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm26",
            email="pm26@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm27",
            email="pm27@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner Timeline",
            email="owner-timeline@example.com",
            phone="555-8383",
            billing_address="83 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Timeline Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )

    def test_project_timeline_returns_workflow_events(self):
        estimate = Estimate.objects.create(
            project=self.project,
            version=1,
            status=Estimate.Status.SENT,
            title="Timeline Estimate",
            created_by=self.user,
        )
        EstimateStatusEvent.objects.create(
            estimate=estimate,
            from_status=Estimate.Status.DRAFT,
            to_status=Estimate.Status.SENT,
            note="Sent for review",
            changed_by=self.user,
        )

        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/timeline/?category=all",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["project_id"], self.project.id)
        self.assertEqual(data["category"], "all")
        self.assertEqual(data["item_count"], 1)
        self.assertEqual(data["items"][0]["category"], "workflow")
        self.assertEqual(data["items"][0]["event_type"], "estimate_status")
        self.assertIn("ui_route", data["items"][0])

    def test_project_timeline_category_filter_validation_and_scope(self):
        invalid = self.client.get(
            f"/api/v1/projects/{self.project.id}/timeline/?category=bad",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Timeline Owner",
            email="other-timeline-owner@example.com",
            phone="555-9393",
            billing_address="93 Main St",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Timeline Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        hidden = self.client.get(
            f"/api/v1/projects/{other_project.id}/timeline/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(hidden.status_code, 404)


class RoleHardeningTests(TestCase):
    def setUp(self):
        self.owner_user = User.objects.create_user(
            username="role-owner",
            email="role-owner@example.com",
            password="secret123",
        )
        self.viewer_user = User.objects.create_user(
            username="role-viewer",
            email="role-viewer@example.com",
            password="secret123",
        )
        self.bookkeeping_user = User.objects.create_user(
            username="role-bookkeeping",
            email="role-bookkeeping@example.com",
            password="secret123",
        )
        self.owner_token, _ = Token.objects.get_or_create(user=self.owner_user)
        self.viewer_token, _ = Token.objects.get_or_create(user=self.viewer_user)
        self.bookkeeping_token, _ = Token.objects.get_or_create(user=self.bookkeeping_user)

        self.org = _bootstrap_org(self.owner_user)
        # viewer and bookkeeping get memberships in the same org
        OrganizationMembership.objects.create(
            organization=self.org, user=self.viewer_user,
            role=OrganizationMembership.Role.VIEWER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        OrganizationMembership.objects.create(
            organization=self.org, user=self.bookkeeping_user,
            role=OrganizationMembership.Role.BOOKKEEPING,
            status=OrganizationMembership.Status.ACTIVE,
        )

        self.viewer_customer = Customer.objects.create(
            organization=self.org,
            display_name="Viewer Owner",
            email="viewer-owner@example.com",
            phone="555-1111",
            billing_address="111 Main St",
            created_by=self.viewer_user,
        )
        self.viewer_project = Project.objects.create(
            organization=self.org,
            customer=self.viewer_customer,
            name="Viewer Project",
            status=Project.Status.ACTIVE,
            created_by=self.viewer_user,
        )
        self.viewer_cost_code, _ = CostCode.objects.get_or_create(
            code="01-010",
            organization=self.org,
            defaults={
                "name": "General Conditions",
                "is_active": True,
                "created_by": self.viewer_user,
            },
        )
        self.viewer_vendor = Vendor.objects.create(
            name="Viewer Vendor",
            email="viewer-vendor@example.com",
            created_by=self.viewer_user,
            organization=self.org,
        )

        self.bookkeeping_customer = Customer.objects.create(
            organization=self.org,
            display_name="Bookkeeping Owner",
            email="bookkeeping-owner@example.com",
            phone="555-2222",
            billing_address="222 Main St",
            created_by=self.bookkeeping_user,
        )
        self.bookkeeping_project = Project.objects.create(
            organization=self.org,
            customer=self.bookkeeping_customer,
            name="Bookkeeping Project",
            status=Project.Status.ACTIVE,
            created_by=self.bookkeeping_user,
        )

    def test_auth_me_returns_effective_role(self):
        response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["user"]["role"], "viewer")

    def test_viewer_cannot_create_invoice_or_payment(self):
        invoice_response = self.client.post(
            f"/api/v1/projects/{self.viewer_project.id}/invoices/",
            data={
                "issue_date": "2026-02-01",
                "due_date": "2026-02-28",
                "line_items": [
                    {
                        "cost_code": self.viewer_cost_code.id,
                        "description": "Scope line",
                        "quantity": "1.00",
                        "unit": "ea",
                        "unit_price": "100.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(invoice_response.status_code, 403)
        self.assertEqual(invoice_response.json()["error"]["code"], "forbidden")

        payment_response = self.client.post(
            f"/api/v1/projects/{self.viewer_project.id}/payments/",
            data={
                "direction": "inbound",
                "method": "ach",
                "status": "pending",
                "amount": "50.00",
                "payment_date": "2026-02-01",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(payment_response.status_code, 403)
        self.assertEqual(payment_response.json()["error"]["code"], "forbidden")

    def test_bookkeeping_can_create_payment(self):
        response = self.client.post(
            f"/api/v1/projects/{self.bookkeeping_project.id}/payments/",
            data={
                "direction": "inbound",
                "method": "ach",
                "status": "pending",
                "amount": "75.00",
                "payment_date": "2026-02-01",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.bookkeeping_token.key}",
        )
        self.assertEqual(response.status_code, 201)

    def test_viewer_cannot_mutate_cost_codes_or_vendors(self):
        cost_code_create = self.client.post(
            "/api/v1/cost-codes/",
            data={"code": "09-900", "name": "Blocked for Viewer", "is_active": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(cost_code_create.status_code, 403)
        self.assertEqual(cost_code_create.json()["error"]["code"], "forbidden")

        cost_code_patch = self.client.patch(
            f"/api/v1/cost-codes/{self.viewer_cost_code.id}/",
            data={"name": "Should Not Update"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(cost_code_patch.status_code, 403)
        self.assertEqual(cost_code_patch.json()["error"]["code"], "forbidden")

        vendor_create = self.client.post(
            "/api/v1/vendors/",
            data={"name": "Blocked Vendor"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(vendor_create.status_code, 403)
        self.assertEqual(vendor_create.json()["error"]["code"], "forbidden")

        vendor_patch = self.client.patch(
            f"/api/v1/vendors/{self.viewer_vendor.id}/",
            data={"name": "Should Not Update Vendor"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(vendor_patch.status_code, 403)
        self.assertEqual(vendor_patch.json()["error"]["code"], "forbidden")
