

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
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner K",
            email="ownerk@example.com",
            phone="555-2020",
            billing_address="11 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="AP Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )
        self.cost_code, _ = CostCode.objects.get_or_create(
            code="50-100",
            organization=self.org,
            defaults={
                "name": "Materials",
                "is_active": True,
                "created_by": self.user,
            },
        )
        self.vendor = Vendor.objects.create(
            name="Supply House",
            email="ap@supply-house.example.com",
            created_by=self.user,
            organization=self.org,
        )
        self.second_vendor = Vendor.objects.create(
            name="Framing Crew",
            email="billing@framing.example.com",
            created_by=self.user,
            organization=self.org,
        )

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Owner L",
            email="ownerl@example.com",
            phone="555-3030",
            billing_address="12 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other AP Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        self.other_vendor = Vendor.objects.create(
            name="Other User Vendor",
            email="ap@other-vendor.example.com",
            created_by=self.other_user,
            organization=self.other_org,
        )

    def _create_vendor_bill(self, *, bill_number="B-1001", total="1250.00"):
        """Create a bill via API. Bills always start as open."""
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "vendor": self.vendor.id,
                "bill_number": bill_number,
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "notes": "Initial AP intake.",
                "line_items": [
                    {"description": "Initial AP intake", "unit_price": total}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def test_vendor_bill_contract_requires_authentication(self):
        response = self.client.get("/api/v1/contracts/vendor-bills/")
        self.assertEqual(response.status_code, 401)

    def test_vendor_bill_contract_matches_model_transition_policy(self):
        response = self.client.get(
            "/api/v1/contracts/vendor-bills/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]

        expected_statuses = [status for status, _label in VendorBill.Status.choices]
        expected_labels = {status: label for status, label in VendorBill.Status.choices}

        self.assertEqual(payload["statuses"], expected_statuses)
        self.assertEqual(payload["status_labels"], expected_labels)
        self.assertEqual(payload["default_create_status"], VendorBill.Status.OPEN)

        # Document lifecycle transitions
        open_transitions = payload["allowed_status_transitions"]["open"]
        self.assertIn("disputed", open_transitions)
        self.assertIn("closed", open_transitions)
        self.assertIn("void", open_transitions)

        disputed_transitions = payload["allowed_status_transitions"]["disputed"]
        self.assertIn("open", disputed_transitions)
        self.assertIn("void", disputed_transitions)

        # Terminal statuses
        self.assertIn("closed", payload["terminal_statuses"])
        self.assertIn("void", payload["terminal_statuses"])
        self.assertTrue(str(payload["policy_version"]).startswith("2026-03-18.vendor_bills."))

    def test_vendor_bill_create_and_project_list(self):
        """Bills are created in open status with description+amount line items."""
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "vendor": self.vendor.id,
                "bill_number": "B-2001",
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "notes": "Tile package.",
                "line_items": [
                    {"description": "Tile package", "unit_price": "1250.00"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], "open")
        self.assertEqual(payload["payment_status"], "unpaid")
        self.assertEqual(payload["vendor"], self.vendor.id)
        self.assertEqual(payload["bill_number"], "B-2001")
        self.assertEqual(payload["total"], "1250.00")
        self.assertEqual(payload["balance_due"], "1250.00")
        # Line items use description + amount (not qty × rate)
        self.assertEqual(len(payload["line_items"]), 1)
        self.assertEqual(payload["line_items"][0]["amount"], "1250.00")
        self.assertEqual(payload["line_items"][0]["description"], "Tile package")

        list_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["project"], self.project.id)

    def test_vendor_bill_create_requires_issue_date(self):
        """Bills require issue_date (all bills start as open)."""
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "vendor": self.vendor.id,
                "bill_number": "B-2003",
                "line_items": [
                    {"description": "Materials", "unit_price": "1250.00"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()["error"]
        self.assertEqual(payload["code"], "validation_error")
        self.assertIn("issue_date", payload["fields"])

    def test_vendor_bill_list_scoped_by_project_and_user(self):
        self._create_vendor_bill()

        VendorBill.objects.create(
            project=self.other_project,
            vendor=self.other_vendor,
            bill_number="B-9999",
            status=VendorBill.Status.OPEN,
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
            status=VendorBill.Status.OPEN,
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
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {"description": "Duplicate test", "unit_price": "500.00"}
                ],
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
                "issue_date": "2026-02-13",
                "due_date": "2026-03-15",
                "line_items": [
                    {"description": "Duplicate test", "unit_price": "500.00"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(allowed.status_code, 201)

    def test_vendor_bill_document_lifecycle_transitions(self):
        """Walk through the full document lifecycle: open → void, open → closed."""
        vendor_bill_id = self._create_vendor_bill(total="900.00")

        # open → void (valid)
        voided = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(voided.status_code, 200)
        self.assertEqual(voided.json()["data"]["status"], "void")

        # void is terminal
        invalid = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "open"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

        # Create another bill to test open → closed
        vendor_bill_id2 = self._create_vendor_bill(bill_number="B-1002", total="900.00")

        # open → closed (valid)
        closed = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id2}/",
            data={"status": "closed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(closed.status_code, 200)
        payload = closed.json()["data"]
        self.assertEqual(payload["status"], "closed")

    def test_vendor_bill_disputed_and_closed_transitions(self):
        """Open bills can be disputed; disputed bills can return to open or be voided."""
        vendor_bill_id = self._create_vendor_bill(total="500.00")

        # open → disputed
        disputed = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "disputed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(disputed.status_code, 200)
        self.assertEqual(disputed.json()["data"]["status"], "disputed")

        # disputed → open (resolve dispute)
        reopened = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "open"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(reopened.status_code, 200)
        self.assertEqual(reopened.json()["data"]["status"], "open")

        # open → closed
        closed = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "closed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(closed.status_code, 200)
        self.assertEqual(closed.json()["data"]["status"], "closed")

        # closed is terminal
        void_attempt = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(void_attempt.status_code, 400)

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

    def test_vendor_bill_patch_rejects_line_items_with_wrong_org_cost_code(self):
        other_code, _ = CostCode.objects.get_or_create(
            code="50-200",
            organization=self.other_org,
            defaults={
                "name": "Other",
                "is_active": True,
                "created_by": self.other_user,
            },
        )
        vendor_bill_id = self._create_vendor_bill(total="100.00")
        response = self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "line_items": [
                    {"cost_code": other_code.id, "description": "Invalid org code", "unit_price": "50.00"}
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_vendor_bill_status_transitions_create_snapshots(self):
        """Each document status transition creates an immutable snapshot."""
        vendor_bill_id = self._create_vendor_bill(total="300.00")

        # open → disputed
        self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "disputed"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        # disputed → void
        self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        snapshots = VendorBillSnapshot.objects.filter(vendor_bill_id=vendor_bill_id).order_by("created_at", "id")
        self.assertEqual(snapshots.count(), 2)
        self.assertEqual(
            list(snapshots.values_list("capture_status", flat=True)),
            ["disputed", "void"],
        )
        self.assertTrue(all(snapshot.acted_by_id == self.user.id for snapshot in snapshots))

    def test_vendor_bill_snapshot_payload_captures_line_items_and_context(self):
        vendor_bill_id = self._create_vendor_bill(total="200.00")

        self.client.patch(
            f"/api/v1/vendor-bills/{vendor_bill_id}/",
            data={
                "status": "closed",
                "line_items": [
                    {"cost_code": self.cost_code.id, "description": "Materials", "unit_price": "200.00"}
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        snapshot = VendorBillSnapshot.objects.filter(
            vendor_bill_id=vendor_bill_id,
            capture_status=VendorBillSnapshot.CaptureStatus.CLOSED,
        ).latest("id")
        self.assertEqual(snapshot.snapshot_json["vendor_bill"]["status"], "closed")
        self.assertEqual(snapshot.snapshot_json["vendor_bill"]["total"], "200.00")
        self.assertEqual(snapshot.snapshot_json["decision_context"]["previous_status"], "open")
        self.assertEqual(snapshot.snapshot_json["decision_context"]["capture_status"], "closed")
        self.assertEqual(len(snapshot.snapshot_json["line_items"]), 1)
        self.assertEqual(snapshot.snapshot_json["line_items"][0]["cost_code_id"], self.cost_code.id)
        # Line items use amount, not qty × rate
        self.assertEqual(snapshot.snapshot_json["line_items"][0]["amount"], "200.00")

    def test_quick_expense_creation(self):
        """Quick expense creates a VendorBill with null vendor via /expenses/ endpoint."""
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/expenses/",
            data={
                "store_name": "Home Depot",
                "total": "237.50",
                "notes": "Lumber run.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        bill = response.json()["data"]
        self.assertEqual(bill["store_name"], "Home Depot")
        self.assertEqual(bill["total"], "237.50")
        self.assertEqual(bill["balance_due"], "0.00")
        self.assertIsNone(bill["vendor"])
        self.assertEqual(bill["vendor_name"], "")
        self.assertEqual(bill["bill_number"], "")
        self.assertEqual(bill["status"], "open")
        self.assertEqual(bill["payment_status"], "paid")

    def test_quick_expense_defaults_issue_date_to_today(self):
        """Quick expense sets issue_date to today when omitted."""
        from django.utils import timezone

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/expenses/",
            data={"total": "50.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        bill = response.json()["data"]
        self.assertEqual(bill["issue_date"], timezone.localdate().isoformat())

    def test_quick_expense_rejects_missing_total(self):
        """Quick expense returns 400 when total is missing."""
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/expenses/",
            data={"store_name": "Home Depot"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_quick_expense_rejects_zero_total(self):
        """Quick expense returns 400 when total is zero."""
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/expenses/",
            data={"total": "0.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_quick_expense_rejects_negative_total(self):
        """Quick expense returns 400 when total is negative."""
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/expenses/",
            data={"total": "-10.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_full_bill_still_requires_vendor_and_bill_number(self):
        """Full vendor bill creation still requires vendor + bill_number + line_items."""
        # Missing vendor
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/vendor-bills/",
            data={
                "bill_number": "INV-001",
                "issue_date": "2026-03-01",
                "line_items": [{"description": "Labor", "amount": "100.00"}],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_unique_constraint_skipped_for_null_vendor(self):
        """Multiple expenses with null vendor don't trigger unique constraint."""
        for _ in range(3):
            response = self.client.post(
                f"/api/v1/projects/{self.project.id}/expenses/",
                data={"store_name": "Home Depot", "total": "50.00"},
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Token {self.token.key}",
            )
            self.assertEqual(response.status_code, 201)
