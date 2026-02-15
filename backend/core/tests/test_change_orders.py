from core.tests.common import *

class ChangeOrderTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm12",
            email="pm12@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm13",
            email="pm13@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        self.customer = Customer.objects.create(
            display_name="Owner G",
            email="ownerg@example.com",
            phone="555-7777",
            billing_address="7 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="CO Project",
            status=Project.Status.ACTIVE,
            contract_value_original="100000.00",
            contract_value_current="100000.00",
            created_by=self.user,
        )
        self.cost_code = CostCode.objects.create(
            code="30-300",
            name="CO Cost Code",
            is_active=True,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            display_name="Owner H",
            email="ownerh@example.com",
            phone="555-8888",
            billing_address="8 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            customer=other_customer,
            name="Other CO Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        self.other_cost_code = CostCode.objects.create(
            code="31-310",
            name="Other CO Cost Code",
            is_active=True,
            created_by=self.other_user,
        )

    def _create_estimate(self, *, project_id: int, cost_code_id: int, token: str):
        response = self.client.post(
            f"/api/v1/projects/{project_id}/estimates/",
            data={
                "title": "Budget Seed Estimate",
                "line_items": [
                    {
                        "cost_code": cost_code_id,
                        "description": "Seed line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "1000",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def _approve_estimate(self, *, estimate_id: int, token: str):
        response = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(response.status_code, 200)

    def _create_active_budget(self, *, project_id: int, cost_code_id: int, token: str):
        estimate_id = self._create_estimate(project_id=project_id, cost_code_id=cost_code_id, token=token)
        self._approve_estimate(estimate_id=estimate_id, token=token)
        response = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def _active_budget(self):
        return Budget.objects.get(
            project=self.project,
            created_by=self.user,
            status=Budget.Status.ACTIVE,
        )

    def _create_change_order(self, *, title="Owner requested upgraded finish", amount_delta="1500.00"):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": title,
                "amount_delta": amount_delta,
                "days_delta": 2,
                "reason": "Scope upgrade",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def test_change_order_create_requires_active_budget(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Deck expansion",
                "amount_delta": "2500.00",
                "days_delta": 3,
                "reason": "Owner requested larger deck",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertEqual(ChangeOrder.objects.count(), 0)

    def test_change_order_create_and_numbering(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )

        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Deck expansion",
                "amount_delta": "2500.00",
                "days_delta": 3,
                "reason": "Owner requested larger deck",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        second = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Lighting package",
                "amount_delta": "800.00",
                "days_delta": 1,
                "reason": "Add recessed lighting",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["data"]["number"], 1)
        self.assertEqual(second.json()["data"]["number"], 2)
        self.assertEqual(ChangeOrder.objects.count(), 2)

    def test_change_order_status_lifecycle_validation(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order()

        invalid = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)
        self.assertEqual(to_pending.json()["data"]["status"], "pending_approval")

        to_approved = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)
        self.assertEqual(to_approved.json()["data"]["status"], "approved")
        self.assertEqual(to_approved.json()["data"]["approved_by"], self.user.id)
        self.assertIsNotNone(to_approved.json()["data"]["approved_at"])

        invalid_after_approved = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_after_approved.status_code, 400)

    def test_change_order_list_and_detail_are_scoped_to_current_user(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        self._create_active_budget(
            project_id=self.other_project.id,
            cost_code_id=self.other_cost_code.id,
            token=self.other_token.key,
        )
        own_id = self._create_change_order()

        other_create = self.client.post(
            f"/api/v1/projects/{self.other_project.id}/change-orders/",
            data={
                "title": "Other user CO",
                "amount_delta": "500.00",
                "days_delta": 1,
                "reason": "Other change",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.other_token.key}",
        )
        self.assertEqual(other_create.status_code, 201)
        other_id = other_create.json()["data"]["id"]

        own_list = self.client.get(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(own_list.status_code, 200)
        self.assertEqual(len(own_list.json()["data"]), 1)
        self.assertEqual(own_list.json()["data"][0]["id"], own_id)

        forbidden_list = self.client.get(
            f"/api/v1/projects/{self.other_project.id}/change-orders/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(forbidden_list.status_code, 404)

        own_detail = self.client.get(
            f"/api/v1/change-orders/{own_id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(own_detail.status_code, 200)
        self.assertEqual(own_detail.json()["data"]["id"], own_id)

        hidden_detail = self.client.get(
            f"/api/v1/change-orders/{other_id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(hidden_detail.status_code, 404)

    def test_rejected_or_void_change_orders_do_not_change_contract_total(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        initial_contract_current = str(self.project.contract_value_current)
        initial_co_total = str(self._active_budget().approved_change_order_total)
        change_order_id = self._create_change_order()

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)

        to_rejected = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_rejected.status_code, 200)

        to_void = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_void.status_code, 200)

        self.project.refresh_from_db()
        self.assertEqual(str(self.project.contract_value_current), initial_contract_current)
        self.assertEqual(str(self._active_budget().approved_change_order_total), initial_co_total)

    def test_approved_change_order_updates_contract_and_budget_totals(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="1500.00")

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)

        to_approved = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)

        self.project.refresh_from_db()
        active_budget = self._active_budget()
        self.assertEqual(str(self.project.contract_value_current), "101500.00")
        self.assertEqual(str(active_budget.approved_change_order_total), "1500.00")

    def test_void_after_approved_reverses_financial_propagation(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="1200.00")

        self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        to_void = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_void.status_code, 200)

        self.project.refresh_from_db()
        active_budget = self._active_budget()
        self.assertEqual(str(self.project.contract_value_current), "100000.00")
        self.assertEqual(str(active_budget.approved_change_order_total), "0.00")

    def test_updating_approved_change_order_amount_adjusts_financial_totals_by_delta(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="900.00")

        self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        amount_update = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"amount_delta": "1000.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(amount_update.status_code, 200)

        self.project.refresh_from_db()
        active_budget = self._active_budget()
        self.assertEqual(str(self.project.contract_value_current), "101000.00")
        self.assertEqual(str(active_budget.approved_change_order_total), "1000.00")


