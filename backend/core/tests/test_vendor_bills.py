from core.tests.common import *


class VendorBillTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm18",
            email="pm18@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm19",
            email="pm19@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            display_name="Owner K",
            email="ownerk@example.com",
            phone="555-2020",
            billing_address="11 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="AP Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )
        self.cost_code = CostCode.objects.create(
            code="50-100",
            name="Materials",
            is_active=True,
            created_by=self.user,
        )
        self.estimate = Estimate.objects.create(
            project=self.project,
            version=1,
            status=Estimate.Status.APPROVED,
            title="AP Seed Estimate",
            created_by=self.user,
        )
        self.budget = Budget.objects.create(
            project=self.project,
            source_estimate=self.estimate,
            status=Budget.Status.ACTIVE,
            baseline_snapshot_json={},
            created_by=self.user,
        )
        self.budget_line = BudgetLine.objects.create(
            budget=self.budget,
            cost_code=self.cost_code,
            description="Materials bucket",
            budget_amount="1500.00",
        )
        self.vendor = Vendor.objects.create(
            name="Supply House",
            email="ap@supply-house.example.com",
            created_by=self.user,
        )
        self.second_vendor = Vendor.objects.create(
            name="Framing Crew",
            email="billing@framing.example.com",
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            display_name="Owner L",
            email="ownerl@example.com",
            phone="555-3030",
            billing_address="12 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            customer=other_customer,
            name="Other AP Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        self.other_vendor = Vendor.objects.create(
            name="Other User Vendor",
            email="ap@other-vendor.example.com",
            created_by=self.other_user,
        )

    def _create_vendor_bill(self, *, bill_number="B-1001", total="1250.00"):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "vendor": self.vendor.id,
                "bill_number": bill_number,
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "total": total,
                "notes": "Initial AP intake.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def test_vendor_bill_create_and_project_list(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "vendor": self.vendor.id,
                "bill_number": "B-2001",
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "total": "1250.00",
                "notes": "Tile package.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], "planned")
        self.assertEqual(payload["vendor"], self.vendor.id)
        self.assertEqual(payload["bill_number"], "B-2001")
        self.assertEqual(payload["total"], "1250.00")
        self.assertEqual(payload["balance_due"], "1250.00")

        list_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["project"], self.project.id)

    def test_vendor_bill_list_scoped_by_project_and_user(self):
        self._create_vendor_bill()

        VendorBill.objects.create(
            project=self.other_project,
            vendor=self.other_vendor,
            bill_number="B-9999",
            status=VendorBill.Status.PLANNED,
            issue_date="2026-02-13",
            due_date="2026-03-20",
            total="200.00",
            balance_due="200.00",
            created_by=self.other_user,
        )

        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["bill_number"], "B-1001")

    def test_vendor_bill_duplicate_requires_existing_match_to_be_void(self):
        VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="B-3100",
            status=VendorBill.Status.RECEIVED,
            issue_date="2026-02-13",
            due_date="2026-03-20",
            total="500.00",
            balance_due="500.00",
            created_by=self.user,
        )

        blocked = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "vendor": self.vendor.id,
                "bill_number": "b-3100",
                "total": "500.00",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["error"]["code"], "duplicate_detected")
        self.assertEqual(
            VendorBill.objects.filter(created_by=self.user, vendor=self.vendor).count(),
            1,
        )
        self.assertEqual(
            blocked.json()["data"]["allowed_resolutions"],
            ["void_existing_bill"],
        )

        existing = VendorBill.objects.get(
            created_by=self.user,
            vendor=self.vendor,
            bill_number="B-3100",
        )
        existing.status = VendorBill.Status.VOID
        existing.save(update_fields=["status"])

        allowed = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "vendor": self.vendor.id,
                "bill_number": "B-3100",
                "total": "500.00",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(allowed.status_code, 201)
        self.assertFalse(allowed.json()["meta"]["duplicate_override_used"])

    def test_vendor_bill_status_transition_and_balance_due(self):
        vendor_bill_id = self._create_vendor_bill(total="900.00")

        invalid = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

        received = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "received"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(received.status_code, 200)

        blocked_approved = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked_approved.status_code, 400)
        self.assertEqual(blocked_approved.json()["error"]["code"], "validation_error")

        for status in ["approved", "scheduled", "paid"]:
            payload = {
                "status": status,
                "allocations": [
                    {"budget_line": self.budget_line.id, "amount": "900.00", "note": "Full alloc"}
                ],
            }
            if status == "scheduled":
                payload["scheduled_for"] = "2026-02-25"
            response = self.client.patch(
                f"/api/v1/vendor-bills/{vendor_bill_id}/",
                data=payload,
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Token {self.token.key}",
            )
            self.assertEqual(response.status_code, 200)

        payload = response.json()["data"]
        self.assertEqual(payload["status"], "paid")
        self.assertEqual(payload["balance_due"], "0.00")
        self.assertEqual(len(payload["allocations"]), 1)
        self.assertEqual(payload["allocations"][0]["budget_line"], self.budget_line.id)

    def test_vendor_bill_can_move_from_approved_to_paid_directly(self):
        vendor_bill_id = self._create_vendor_bill(total="900.00")

        received = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "received"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(received.status_code, 200)

        approved = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "status": "approved",
                "allocations": [
                    {"budget_line": self.budget_line.id, "amount": "900.00", "note": "Full alloc"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)

        paid = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "status": "paid",
                "allocations": [
                    {"budget_line": self.budget_line.id, "amount": "900.00", "note": "Paid direct"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(paid.status_code, 200)
        self.assertEqual(paid.json()["data"]["status"], "paid")

    def test_vendor_bill_patch_rejects_bill_number_change(self):
        vendor_bill_id = self._create_vendor_bill(bill_number="B-4200", total="300.00")

        blocked = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"bill_number": "B-4201"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.json()["error"]["code"], "validation_error")

    def test_vendor_bill_patch_validates_vendor_scope_and_due_dates(self):
        vendor_bill_id = self._create_vendor_bill()

        invalid_vendor = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"vendor": self.other_vendor.id},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_vendor.status_code, 400)
        self.assertEqual(invalid_vendor.json()["error"]["code"], "validation_error")

        invalid_due = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "issue_date": "2026-02-20",
                "due_date": "2026-02-10",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_due.status_code, 400)
        self.assertEqual(invalid_due.json()["error"]["code"], "validation_error")

    def test_vendor_bill_patch_rejects_allocation_total_exceeding_bill_total(self):
        vendor_bill_id = self._create_vendor_bill(total="100.00")
        response = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "allocations": [
                    {"budget_line": self.budget_line.id, "amount": "120.00", "note": "Over alloc"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_vendor_bill_patch_requires_scheduled_for_when_status_scheduled(self):
        vendor_bill_id = self._create_vendor_bill(total="200.00")
        received = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "received"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(received.status_code, 200)
        approved = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "status": "approved",
                "allocations": [
                    {"budget_line": self.budget_line.id, "amount": "200.00", "note": "Full alloc"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)
        scheduled = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "scheduled"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(scheduled.status_code, 400)
        self.assertEqual(scheduled.json()["error"]["code"], "validation_error")

    def test_vendor_bill_patch_requires_full_allocation_when_status_scheduled(self):
        vendor_bill_id = self._create_vendor_bill(total="200.00")
        received = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "received"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(received.status_code, 200)
        approved = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "status": "approved",
                "allocations": [
                    {"budget_line": self.budget_line.id, "amount": "200.00", "note": "Full alloc"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)

        scheduled = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "status": "scheduled",
                "scheduled_for": "2026-02-25",
                "allocations": [
                    {"budget_line": self.budget_line.id, "amount": "150.00", "note": "Partial alloc"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(scheduled.status_code, 400)
        payload = scheduled.json()["error"]
        self.assertEqual(payload["code"], "validation_error")
        self.assertEqual(
            payload["message"],
            "Approved, scheduled, and paid bills must be fully allocated.",
        )
        self.assertEqual(payload["fields"]["allocations"], ["Allocation total must equal bill total."])

    def test_vendor_bill_patch_rejects_allocation_with_wrong_project_budget_line(self):
        other_code = CostCode.objects.create(
            code="50-200",
            name="Other",
            is_active=True,
            created_by=self.other_user,
        )
        other_estimate = Estimate.objects.create(
            project=self.other_project,
            version=1,
            status=Estimate.Status.APPROVED,
            title="Other AP Seed Estimate",
            created_by=self.other_user,
        )
        other_budget = Budget.objects.create(
            project=self.other_project,
            source_estimate=other_estimate,
            status=Budget.Status.ACTIVE,
            baseline_snapshot_json={},
            created_by=self.other_user,
        )
        other_line = BudgetLine.objects.create(
            budget=other_budget,
            cost_code=other_code,
            description="Other line",
            budget_amount="100.00",
        )
        vendor_bill_id = self._create_vendor_bill(total="100.00")
        response = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "allocations": [
                    {"budget_line": other_line.id, "amount": "50.00", "note": "Invalid project line"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
