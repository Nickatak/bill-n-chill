from core.tests.common import *

class BudgetTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm10",
            email="pm10@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm11",
            email="pm11@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

        self.customer = Customer.objects.create(
            display_name="Owner E",
            email="ownere@example.com",
            phone="555-5555",
            billing_address="5 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Budget Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            display_name="Owner F",
            email="ownerf@example.com",
            phone="555-6666",
            billing_address="6 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            customer=other_customer,
            name="Other Budget Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )

        self.cost_code = CostCode.objects.create(
            code="10-100",
            name="Budget Cost Code",
            is_active=True,
            created_by=self.user,
        )

    def _create_estimate(self, *, title: str, unit_cost: str):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": title,
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": f"{title} line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": unit_cost,
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def _approve_estimate(self, estimate_id: int):
        to_sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)

        to_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)

    def test_convert_to_budget_blocks_non_approved_estimate(self):
        estimate_id = self._create_estimate(title="Draft Estimate", unit_cost="500")

        response = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertEqual(Budget.objects.count(), 0)

    def test_convert_to_budget_creates_snapshot_and_editable_lines(self):
        estimate_id = self._create_estimate(title="Approved Estimate", unit_cost="500")
        self._approve_estimate(estimate_id)

        response = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["meta"]["conversion_status"], "converted")
        self.assertEqual(response.json()["data"]["approved_change_order_total"], "0.00")
        self.assertEqual(response.json()["data"]["base_working_total"], "500.00")
        self.assertEqual(response.json()["data"]["current_working_total"], "500.00")
        self.assertEqual(Budget.objects.count(), 1)
        self.assertEqual(BudgetLine.objects.count(), 1)

        budget = Budget.objects.first()
        line = BudgetLine.objects.first()
        self.assertEqual(budget.status, Budget.Status.ACTIVE)
        self.assertEqual(budget.source_estimate_id, estimate_id)
        self.assertEqual(str(line.budget_amount), "500.00")
        self.assertEqual(budget.baseline_snapshot_json["estimate"]["id"], estimate_id)
        self.assertEqual(
            budget.baseline_snapshot_json["line_items"][0]["line_total"],
            "500.00",
        )

    def test_convert_to_budget_is_idempotent_for_same_estimate(self):
        estimate_id = self._create_estimate(title="Approved Estimate", unit_cost="500")
        self._approve_estimate(estimate_id)

        first = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        second = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["meta"]["conversion_status"], "already_converted")
        self.assertEqual(Budget.objects.count(), 1)

    def test_converting_new_budget_supersedes_previous_active_budget(self):
        first_estimate_id = self._create_estimate(title="Approved Estimate A", unit_cost="500")
        self._approve_estimate(first_estimate_id)
        first_conversion = self.client.post(
            f"/api/v1/estimates/{first_estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first_conversion.status_code, 201)
        first_budget_id = first_conversion.json()["data"]["id"]

        second_estimate_id = self._create_estimate(title="Approved Estimate B", unit_cost="700")
        self._approve_estimate(second_estimate_id)
        second_conversion = self.client.post(
            f"/api/v1/estimates/{second_estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second_conversion.status_code, 201)

        first_budget = Budget.objects.get(id=first_budget_id)
        second_budget = Budget.objects.get(id=second_conversion.json()["data"]["id"])
        self.assertEqual(first_budget.status, Budget.Status.SUPERSEDED)
        self.assertEqual(second_budget.status, Budget.Status.ACTIVE)

    def test_budget_line_patch_updates_working_budget_without_mutating_snapshot(self):
        estimate_id = self._create_estimate(title="Approved Estimate", unit_cost="500")
        self._approve_estimate(estimate_id)

        conversion = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(conversion.status_code, 201)
        budget_id = conversion.json()["data"]["id"]
        line_id = conversion.json()["data"]["line_items"][0]["id"]

        update = self.client.patch(
            f"/api/v1/budgets/{budget_id}/lines/{line_id}/",
            data={"description": "Revised scope", "budget_amount": "650.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.json()["data"]["description"], "Revised scope")
        self.assertEqual(update.json()["data"]["budget_amount"], "650.00")

        budget = Budget.objects.get(id=budget_id)
        line = BudgetLine.objects.get(id=line_id)
        self.assertEqual(str(line.budget_amount), "650.00")
        self.assertEqual(
            budget.baseline_snapshot_json["line_items"][0]["line_total"],
            "500.00",
        )

    def test_project_budgets_list_is_scoped_to_current_user(self):
        estimate_id = self._create_estimate(title="Approved Estimate", unit_cost="500")
        self._approve_estimate(estimate_id)
        self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        own_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/budgets/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(own_response.status_code, 200)
        rows = own_response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["project"], self.project.id)

        other_project_response = self.client.get(
            f"/api/v1/projects/{self.other_project.id}/budgets/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(other_project_response.status_code, 404)

    def test_project_budgets_list_includes_line_planned_actual_and_remaining_amounts(self):
        estimate_id = self._create_estimate(title="Approved Estimate", unit_cost="500")
        self._approve_estimate(estimate_id)
        conversion = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(conversion.status_code, 201)
        budget_line_id = conversion.json()["data"]["line_items"][0]["id"]

        vendor = Vendor.objects.create(
            name="Spend Vendor",
            email="ap@spend-vendor.example.com",
            created_by=self.user,
        )
        paid_bill = VendorBill.objects.create(
            project=self.project,
            vendor=vendor,
            bill_number="B-PLANNED-1",
            status=VendorBill.Status.PAID,
            issue_date="2026-02-20",
            due_date="2026-03-20",
            total="125.00",
            balance_due="0.00",
            created_by=self.user,
        )
        VendorBillAllocation.objects.create(
            vendor_bill=paid_bill,
            budget_line_id=budget_line_id,
            amount="125.00",
            note="Paid allocation",
        )

        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/budgets/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        line = response.json()["data"][0]["line_items"][0]
        self.assertEqual(line["planned_amount"], "500.00")
        self.assertEqual(line["actual_spend"], "125.00")
        self.assertEqual(line["remaining_amount"], "375.00")

