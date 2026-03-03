from unittest.mock import patch

from django.core.exceptions import ValidationError

from core.tests.common import *


SYSTEM_BUDGET_LINE_CODES = {"99-901", "99-902", "99-903"}


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
        self.last_approved_estimate_by_project = {}

    def _bootstrap_primary_membership(self):
        response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "pm12@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        return OrganizationMembership.objects.select_related("organization").get(user=self.user)

    def _create_estimate(self, *, project_id: int, cost_code_id: int, token: str, title: str = "Budget Seed Estimate"):
        response = self.client.post(
            f"/api/v1/projects/{project_id}/estimates/",
            data={
                "title": title,
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

    def _create_estimate_family(self, *, title: str = "Budget Seed Estimate"):
        estimate_id = self._create_estimate(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
            title=title,
        )
        self._approve_estimate(estimate_id=estimate_id, token=self.token.key)
        self.last_approved_estimate_by_project[self.project.id] = estimate_id
        return Estimate.objects.get(id=estimate_id)

    def _approve_estimate(self, *, estimate_id: int, token: str):
        sent_response = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(sent_response.status_code, 200)
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
        self.last_approved_estimate_by_project[project_id] = estimate_id
        response = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertIn(response.status_code, {200, 201})
        return response.json()["data"]["id"]

    def _active_budget(self):
        return Budget.objects.get(
            project=self.project,
            created_by=self.user,
            status=Budget.Status.ACTIVE,
        )

    def _active_budget_line(self):
        return BudgetLine.objects.filter(
            budget__project=self.project,
            budget__status=Budget.Status.ACTIVE,
        ).exclude(
            cost_code__code__in=SYSTEM_BUDGET_LINE_CODES,
        ).order_by("id").first()

    def _generic_budget_line(self):
        return BudgetLine.objects.filter(
            budget__project=self.project,
            budget__status=Budget.Status.ACTIVE,
            cost_code__code__in=SYSTEM_BUDGET_LINE_CODES,
        ).order_by("id").first()

    def _create_change_order(self, *, title="Owner requested upgraded finish", amount_delta="1500.00"):
        origin_estimate_id = self.last_approved_estimate_by_project.get(self.project.id)
        if not origin_estimate_id:
            origin_estimate_id = self._create_estimate_family().id
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": title,
                "amount_delta": amount_delta,
                "days_delta": 2,
                "reason": "Scope upgrade",
                "origin_estimate": origin_estimate_id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        return response.json()["data"]["id"]

    def _assert_validation_rule(self, response, expected_rule: str):
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertEqual(payload["error"].get("rule"), expected_rule)

    def test_change_order_contract_requires_authentication(self):
        response = self.client.get("/api/v1/contracts/change-orders/")
        self.assertEqual(response.status_code, 401)

    def test_public_change_order_detail_view_allows_unauthenticated_access(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order()
        change_order = ChangeOrder.objects.get(id=change_order_id)

        response = self.client.get(f"/api/v1/public/change-orders/{change_order.public_token}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["id"], change_order.id)
        self.assertTrue(payload["public_ref"].endswith(f"--{change_order.public_token}"))
        self.assertEqual(payload["project_context"]["id"], self.project.id)
        self.assertEqual(payload["project_context"]["customer_display_name"], self.customer.display_name)
        self.assertIn("organization_context", payload)
        self.assertIn("sender_name", payload["organization_context"])
        self.assertIn("help_email", payload["organization_context"])

    def test_public_change_order_decision_view_approves_pending_approval(self):
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

        response = self.client.post(
            f"/api/v1/public/change-orders/{ChangeOrder.objects.get(id=change_order_id).public_token}/decision/",
            data={"decision": "approve", "decider_name": "Owner", "note": "Approved publicly."},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], ChangeOrder.Status.APPROVED)

        change_order = ChangeOrder.objects.get(id=change_order_id)
        self.assertEqual(change_order.status, ChangeOrder.Status.APPROVED)
        self.assertIsNotNone(change_order.approved_by_id)
        self.assertIsNotNone(change_order.approved_at)
        self.project.refresh_from_db()
        self.assertEqual(str(self.project.contract_value_current), "101500.00")

    def test_public_change_order_decision_view_rejects_pending_approval(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order()

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)

        response = self.client.post(
            f"/api/v1/public/change-orders/{ChangeOrder.objects.get(id=change_order_id).public_token}/decision/",
            data={"decision": "reject", "decider_email": "owner@example.com"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], ChangeOrder.Status.REJECTED)
        change_order = ChangeOrder.objects.get(id=change_order_id)
        self.assertEqual(change_order.status, ChangeOrder.Status.REJECTED)

    def test_change_order_contract_matches_model_transition_policy(self):
        response = self.client.get(
            "/api/v1/contracts/change-orders/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]

        expected_statuses = [status for status, _label in ChangeOrder.Status.choices]
        expected_labels = {status: label for status, label in ChangeOrder.Status.choices}
        expected_transitions = {}
        for status in expected_statuses:
            next_statuses = list(ChangeOrder.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
            next_statuses.sort(key=lambda value: expected_statuses.index(value))
            expected_transitions[status] = next_statuses
        expected_terminal_statuses = [
            status for status in expected_statuses if not expected_transitions.get(status, [])
        ]

        self.assertEqual(payload["statuses"], expected_statuses)
        self.assertEqual(payload["status_labels"], expected_labels)
        self.assertEqual(payload["default_create_status"], ChangeOrder.Status.DRAFT)
        self.assertEqual(payload["allowed_status_transitions"], expected_transitions)
        self.assertEqual(payload["terminal_statuses"], expected_terminal_statuses)
        self.assertEqual(
            payload["revision_rules"],
            {
                "edit_latest_revision_only": True,
                "edit_requires_draft_status": True,
                "clone_requires_latest_revision": True,
                "revision_gt_one_requires_previous_change_order": True,
                "previous_change_order_must_match_project_family_and_prior_revision": True,
            },
        )
        self.assertEqual(
            payload["origin_estimate_rules"],
            {
                "required_on_create": True,
                "must_be_approved": True,
                "must_match_change_order_project": True,
                "immutable_once_set": True,
            },
        )
        self.assertEqual(
            payload["approval_metadata_rules"],
            {
                "approved_requires_actor_and_timestamp": True,
                "non_approved_statuses_must_clear_actor_and_timestamp": True,
            },
        )
        self.assertEqual(
            payload["error_rules"],
            {
                "co_create_missing_required_fields": "Create requires title and amount_delta.",
                "co_budget_active_required_for_propagation": "Project must have an active budget before CO create/propagation.",
                "co_create_origin_estimate_required": "Create requires origin_estimate.",
                "co_origin_estimate_project_scope": "origin_estimate must belong to the same project.",
                "co_origin_estimate_approved_required": "origin_estimate must be approved.",
                "co_origin_estimate_immutable_once_set": "origin_estimate cannot change/clear once set.",
                "co_line_total_must_match_amount_delta": "Sum of line_items amount_delta must match change-order amount_delta.",
                "co_line_duplicate_budget_line": "Each budget_line can appear at most once per change order.",
                "co_line_budget_line_invalid": "Each budget_line must exist, match project, and come from active budget.",
                "co_line_scope_budget_line_disallows_generic": "Scope lines cannot use internal generic budget lines.",
                "co_line_adjustment_requires_reason": "Adjustment lines require adjustment_reason.",
                "co_line_adjustment_requires_generic_budget_line": "Adjustment lines must use a generic system budget line.",
                "co_edit_latest_revision_only": "Only latest revision in family can be edited.",
                "co_edit_requires_draft_status": "Only draft change orders can edit content fields.",
                "co_clone_requires_latest_revision": "Clone revision only from latest revision in family.",
                "co_status_transition_not_allowed": "Status transition must match allowed_status_transitions.",
                "co_approval_metadata_invariant": "approved_by/approved_at must match approved status invariants.",
                "co_revision_chain_invalid": "Revision chain must keep project/family/previous linkage integrity.",
            },
        )
        self.assertTrue(str(payload["policy_version"]).startswith("2026-02-24.change_orders."))

    def test_change_order_create_requires_active_budget(self):
        estimate_id = self._create_estimate(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Deck expansion",
                "amount_delta": "2500.00",
                "days_delta": 3,
                "reason": "Owner requested larger deck",
                "origin_estimate": estimate_id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self._assert_validation_rule(response, "co_budget_active_required_for_propagation")
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
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
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
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["data"]["family_key"], "1")
        self.assertEqual(second.json()["data"]["family_key"], "2")
        self.assertEqual(ChangeOrder.objects.count(), 2)

    def test_change_order_create_uses_org_default_reason_when_payload_omits_reason(self):
        membership = self._bootstrap_primary_membership()
        membership.organization.change_order_default_reason = "Default org change-order reason."
        membership.organization.save(update_fields=["change_order_default_reason", "updated_at"])
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Missing reason payload",
                "amount_delta": "500.00",
                "days_delta": 1,
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["reason"], "Default org change-order reason.")

    def test_change_order_create_allows_per_change_order_reason_override(self):
        membership = self._bootstrap_primary_membership()
        membership.organization.change_order_default_reason = "Template-owned change-order reason."
        membership.organization.save(update_fields=["change_order_default_reason", "updated_at"])
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Reason override honored",
                "amount_delta": "500.00",
                "days_delta": 1,
                "reason": "User-provided reason should be honored",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["reason"], "User-provided reason should be honored")

    def test_change_order_patch_allows_reason_updates(self):
        membership = self._bootstrap_primary_membership()
        membership.organization.change_order_default_reason = "Template reason v1."
        membership.organization.save(update_fields=["change_order_default_reason", "updated_at"])
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        co_id = self._create_change_order(title="Patch reason update")

        response = self.client.patch(
            f"/api/v1/change-orders/{co_id}/",
            data={"reason": "Patch override accepted"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["reason"], "Patch override accepted")

    def test_change_order_create_rolls_back_when_audit_write_fails(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )

        with patch(
            "core.views.change_orders.change_orders._record_financial_audit_event",
            side_effect=RuntimeError("capture-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    f"/api/v1/projects/{self.project.id}/change-orders/",
                    data={
                        "title": "Rollback CO",
                        "amount_delta": "2500.00",
                        "days_delta": 3,
                        "reason": "Rollback path",
                        "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                    },
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertEqual(ChangeOrder.objects.count(), 0)
        self.assertEqual(ChangeOrderLine.objects.count(), 0)
        self.assertEqual(FinancialAuditEvent.objects.filter(object_type="change_order").count(), 0)

    def test_change_order_create_with_line_items_scaffold(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        budget_line = self._active_budget_line()
        self.assertIsNotNone(budget_line)

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Line-coupled CO",
                "amount_delta": "2500.00",
                "days_delta": 3,
                "reason": "Line-level coupling scaffold",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Cabinet scope delta",
                        "amount_delta": "2500.00",
                        "days_delta": 3,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["line_total_delta"], "2500.00")
        self.assertEqual(len(payload["line_items"]), 1)
        self.assertEqual(payload["line_items"][0]["budget_line"], budget_line.id)

    def test_change_order_create_with_origin_estimate_link(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        estimate = self._create_estimate_family(title="CO Origin Estimate")

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Linked CO",
                "amount_delta": "2500.00",
                "days_delta": 3,
                "reason": "Linked to approved estimate",
                "origin_estimate": estimate.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["origin_estimate"], estimate.id)
        self.assertNotIn("origin_estimate_version", payload)
        self.assertEqual(payload["revision_number"], 1)
        self.assertEqual(payload["is_latest_revision"], True)

    def test_change_order_create_requires_origin_estimate(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Missing Origin CO",
                "amount_delta": "500.00",
                "days_delta": 1,
                "reason": "Missing origin estimate linkage",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(response, "co_create_origin_estimate_required")
        self.assertIn("origin_estimate", response.json()["error"]["fields"])

    def test_change_order_create_rejects_non_approved_origin_estimate(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        draft_estimate_id = self._create_estimate(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
            title="Draft Only Estimate",
        )
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Draft origin CO",
                "amount_delta": "500.00",
                "days_delta": 1,
                "reason": "Invalid origin status",
                "origin_estimate": draft_estimate_id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(response, "co_origin_estimate_approved_required")
        self.assertIn("origin_estimate", response.json()["error"]["fields"])

    def test_change_order_create_rejects_line_total_mismatch(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        budget_line = self._active_budget_line()
        self.assertIsNotNone(budget_line)

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Mismatch CO",
                "amount_delta": "2500.00",
                "days_delta": 3,
                "reason": "Line mismatch",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Cabinet scope delta",
                        "amount_delta": "2000.00",
                        "days_delta": 3,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(response, "co_line_total_must_match_amount_delta")

    def test_change_order_patch_updates_line_items_scaffold(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        budget_line = self._active_budget_line()
        self.assertIsNotNone(budget_line)
        change_order_id = self._create_change_order(amount_delta="1200.00")

        response = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Line-level delta",
                        "amount_delta": "1200.00",
                        "days_delta": 2,
                    }
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["line_total_delta"], "1200.00")
        self.assertEqual(len(payload["line_items"]), 1)

    def test_change_order_clone_revision_creates_next_revision_in_same_family(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        estimate = self._create_estimate_family(title="Clone Revision Estimate")
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Revision Family CO",
                "amount_delta": "1800.00",
                "days_delta": 2,
                "reason": "Base revision",
                "origin_estimate": estimate.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        base = create.json()["data"]
        base_id = base["id"]

        clone = self.client.post(
            f"/api/v1/change-orders/{base_id}/clone-revision/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)
        payload = clone.json()["data"]
        self.assertEqual(payload["family_key"], base["family_key"])
        self.assertEqual(payload["revision_number"], 2)
        self.assertEqual(payload["status"], "draft")
        self.assertEqual(payload["previous_change_order"], base_id)
        self.assertEqual(payload["origin_estimate"], estimate.id)

    def test_change_order_patch_rejects_non_latest_revision_edit(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        base_id = self._create_change_order()
        clone = self.client.post(
            f"/api/v1/change-orders/{base_id}/clone-revision/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)

        blocked = self.client.patch(
            f"/api/v1/change-orders/{base_id}/",
            data={"title": "Should Not Edit"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(blocked, "co_edit_latest_revision_only")

    def test_change_order_patch_allows_non_latest_revision_status_update(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        base_id = self._create_change_order(amount_delta="800.00")
        to_pending = self.client.patch(
            f"/api/v1/change-orders/{base_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)
        to_rejected = self.client.patch(
            f"/api/v1/change-orders/{base_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_rejected.status_code, 200)

        clone = self.client.post(
            f"/api/v1/change-orders/{base_id}/clone-revision/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)

        non_latest_status_update = self.client.patch(
            f"/api/v1/change-orders/{base_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(non_latest_status_update.status_code, 200)
        self.assertEqual(non_latest_status_update.json()["data"]["status"], "void")

    def test_change_order_patch_rejects_origin_estimate_change_or_clear(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order()

        newer_estimate = self._create_estimate_family(title="Newer Origin Estimate")
        changed = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"origin_estimate": newer_estimate.id},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(changed, "co_origin_estimate_immutable_once_set")

        cleared = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"origin_estimate": None},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(cleared, "co_origin_estimate_immutable_once_set")

    def test_change_order_create_rejects_duplicate_line_items_for_same_budget_line(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        budget_line = self._active_budget_line()
        self.assertIsNotNone(budget_line)

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Duplicate Budget Line CO",
                "amount_delta": "200.00",
                "days_delta": 1,
                "reason": "Prevent duplicate line items for the same budget line",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Row 1",
                        "amount_delta": "100.00",
                        "days_delta": 1,
                    },
                    {
                        "budget_line": budget_line.id,
                        "description": "Row 2",
                        "amount_delta": "100.00",
                        "days_delta": 0,
                    },
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(response, "co_line_duplicate_budget_line")

    def test_change_order_line_rejects_budget_line_from_different_project(self):
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

        other_budget_line = BudgetLine.objects.filter(
            budget__project=self.other_project,
            budget__status=Budget.Status.ACTIVE,
        ).order_by("id").first()
        self.assertIsNotNone(other_budget_line)

        cross_project_response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Cross project line CO",
                "amount_delta": "300.00",
                "days_delta": 1,
                "reason": "Invalid line ownership",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "budget_line": other_budget_line.id,
                        "description": "Invalid cross-project budget line",
                        "amount_delta": "300.00",
                        "days_delta": 1,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(cross_project_response, "co_line_budget_line_invalid")

    def test_change_order_line_scope_rejects_generic_budget_line(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        generic_budget_line = self._generic_budget_line()
        self.assertIsNotNone(generic_budget_line)

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Generic line used as scope",
                "amount_delta": "100.00",
                "days_delta": 1,
                "reason": "Should fail",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "line_type": "scope",
                        "budget_line": generic_budget_line.id,
                        "description": "Invalid scope/generic linkage",
                        "amount_delta": "100.00",
                        "days_delta": 1,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(response, "co_line_scope_budget_line_disallows_generic")

    def test_change_order_line_adjustment_requires_reason(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        generic_budget_line = self._generic_budget_line()
        self.assertIsNotNone(generic_budget_line)

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Adjustment missing reason",
                "amount_delta": "75.00",
                "days_delta": 0,
                "reason": "Should fail",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "line_type": "adjustment",
                        "budget_line": generic_budget_line.id,
                        "description": "Adjustment row",
                        "adjustment_reason": "",
                        "amount_delta": "75.00",
                        "days_delta": 0,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(response, "co_line_adjustment_requires_reason")

    def test_change_order_line_adjustment_requires_generic_budget_line(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        scope_budget_line = self._active_budget_line()
        self.assertIsNotNone(scope_budget_line)

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Adjustment non-generic budget line",
                "amount_delta": "60.00",
                "days_delta": 0,
                "reason": "Should fail",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "line_type": "adjustment",
                        "budget_line": scope_budget_line.id,
                        "description": "Invalid adjustment target",
                        "adjustment_reason": "Rounding adjustment",
                        "amount_delta": "60.00",
                        "days_delta": 0,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(response, "co_line_adjustment_requires_generic_budget_line")

    def test_change_order_line_adjustment_allows_generic_budget_line_with_reason(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        generic_budget_line = self._generic_budget_line()
        self.assertIsNotNone(generic_budget_line)

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Valid adjustment line",
                "amount_delta": "125.00",
                "days_delta": 0,
                "reason": "Valid adjustment flow",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "line_type": "adjustment",
                        "budget_line": generic_budget_line.id,
                        "description": "General correction",
                        "adjustment_reason": "Reconciliation adjustment",
                        "amount_delta": "125.00",
                        "days_delta": 0,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        line = response.json()["data"]["line_items"][0]
        self.assertEqual(line["line_type"], "adjustment")
        self.assertEqual(line["adjustment_reason"], "Reconciliation adjustment")

    def test_change_order_line_rejects_budget_line_from_non_active_budget(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )

        own_budget_line = self._active_budget_line()
        self.assertIsNotNone(own_budget_line)
        change_order_id = self._create_change_order(amount_delta="300.00")

        own_budget = self._active_budget()
        own_budget.status = Budget.Status.SUPERSEDED
        own_budget.save(update_fields=["status"])

        non_active_response = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={
                "line_items": [
                    {
                        "budget_line": own_budget_line.id,
                        "description": "Non-active budget line",
                        "amount_delta": "300.00",
                        "days_delta": 1,
                    }
                ]
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(non_active_response, "co_line_budget_line_invalid")
        self.assertIn("budget_line", non_active_response.json()["error"]["fields"])

    def test_change_order_model_blocks_invalid_status_transition_on_save(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order()

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

        row = ChangeOrder.objects.get(id=change_order_id)
        row.status = ChangeOrder.Status.REJECTED
        with self.assertRaises(ValidationError):
            row.save()

    def test_change_order_model_requires_previous_change_order_for_revision_gt_one(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        origin_estimate_id = self.last_approved_estimate_by_project[self.project.id]

        with self.assertRaises(ValidationError):
            ChangeOrder.objects.create(
                project=self.project,
                family_key="99",
                revision_number=2,
                title="Invalid direct revision",
                status=ChangeOrder.Status.DRAFT,
                amount_delta="100.00",
                days_delta=0,
                reason="Missing previous_change_order",
                origin_estimate_id=origin_estimate_id,
                requested_by=self.user,
            )

    def test_change_order_model_rejects_revision_number_mismatch_with_previous_change_order(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        base_id = self._create_change_order(amount_delta="100.00")
        base = ChangeOrder.objects.get(id=base_id)

        with self.assertRaises(ValidationError):
            ChangeOrder.objects.create(
                project=self.project,
                family_key=base.family_key,
                revision_number=5,
                title="Invalid revision chain",
                status=ChangeOrder.Status.DRAFT,
                amount_delta="120.00",
                days_delta=0,
                reason="Revision mismatch",
                origin_estimate=base.origin_estimate,
                previous_change_order=base,
                requested_by=self.user,
            )

    def test_change_order_model_rejects_cross_project_origin_estimate_on_direct_save(self):
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
        other_origin_estimate_id = self.last_approved_estimate_by_project[self.other_project.id]

        with self.assertRaises(ValidationError):
            ChangeOrder.objects.create(
                project=self.project,
                family_key="100",
                revision_number=1,
                title="Invalid origin estimate scope",
                status=ChangeOrder.Status.DRAFT,
                amount_delta="100.00",
                days_delta=0,
                reason="Cross-project origin",
                origin_estimate_id=other_origin_estimate_id,
                requested_by=self.user,
            )

    def test_change_order_model_rejects_cross_project_previous_change_order_on_direct_save(self):
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
        other_change_order = self.client.post(
            f"/api/v1/projects/{self.other_project.id}/change-orders/",
            data={
                "title": "Other user base CO",
                "amount_delta": "200.00",
                "days_delta": 1,
                "reason": "Other project chain",
                "origin_estimate": self.last_approved_estimate_by_project[self.other_project.id],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.other_token.key}",
        )
        self.assertEqual(other_change_order.status_code, 201)
        other_change_order_id = other_change_order.json()["data"]["id"]
        other_change_order_row = ChangeOrder.objects.get(id=other_change_order_id)

        with self.assertRaises(ValidationError):
            ChangeOrder.objects.create(
                project=self.project,
                family_key=other_change_order_row.family_key,
                revision_number=2,
                title="Invalid previous linkage",
                status=ChangeOrder.Status.DRAFT,
                amount_delta="250.00",
                days_delta=1,
                reason="Cross-project previous row",
                origin_estimate_id=self.last_approved_estimate_by_project[self.project.id],
                previous_change_order=other_change_order_row,
                requested_by=self.user,
            )

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
        self._assert_validation_rule(invalid, "co_status_transition_not_allowed")

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
        self._assert_validation_rule(invalid_after_approved, "co_status_transition_not_allowed")

        invalid_void_after_approved = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(invalid_void_after_approved, "co_status_transition_not_allowed")

        rejected_co_id = self._create_change_order(amount_delta="300.00")
        self.client.patch(
            f"/api/v1/change-orders/{rejected_co_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        to_rejected = self.client.patch(
            f"/api/v1/change-orders/{rejected_co_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_rejected.status_code, 200)

        invalid_after_rejected = self.client.patch(
            f"/api/v1/change-orders/{rejected_co_id}/",
            data={"status": "draft"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(invalid_after_rejected, "co_status_transition_not_allowed")

    def test_pending_approval_resend_records_audit_event(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="900.00")

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)

        resend = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resend.status_code, 200)
        self.assertEqual(resend.json()["data"]["status"], "pending_approval")

        resend_event = FinancialAuditEvent.objects.filter(
            object_type="change_order",
            object_id=change_order_id,
            from_status=ChangeOrder.Status.PENDING_APPROVAL,
            to_status=ChangeOrder.Status.PENDING_APPROVAL,
        ).latest("id")
        self.assertEqual(resend_event.note, "Change order re-sent for approval.")

    def test_change_order_status_note_without_transition_records_audit_event(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="900.00")

        note_only = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status_note": "Internal note: owner requested billing split."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(note_only.status_code, 200)
        self.assertEqual(note_only.json()["data"]["status"], ChangeOrder.Status.DRAFT)

        note_event = FinancialAuditEvent.objects.filter(
            object_type="change_order",
            object_id=change_order_id,
            from_status=ChangeOrder.Status.DRAFT,
            to_status=ChangeOrder.Status.DRAFT,
            note="Internal note: owner requested billing split.",
        ).first()
        self.assertIsNotNone(note_event)
        self.assertEqual(note_event.metadata_json.get("status_action"), "notate")

    def test_pending_approval_cannot_transition_back_to_draft(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="900.00")

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)

        back_to_draft = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "draft"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(back_to_draft, "co_status_transition_not_allowed")

    def test_change_order_patch_rejects_content_edits_when_pending_approval(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="900.00")

        to_pending = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)

        blocked = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"title": "Should be read-only after send"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(blocked, "co_edit_requires_draft_status")

    def test_change_order_patch_rejects_content_edits_when_approved_rejected_or_void(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )

        approved_id = self._create_change_order(title="Approved lock", amount_delta="900.00")
        self.client.patch(
            f"/api/v1/change-orders/{approved_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/change-orders/{approved_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        approved_blocked = self.client.patch(
            f"/api/v1/change-orders/{approved_id}/",
            data={"reason": "Attempted post-approval edit"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(approved_blocked, "co_edit_requires_draft_status")

        rejected_void_id = self._create_change_order(title="Rejected/void lock", amount_delta="450.00")
        self.client.patch(
            f"/api/v1/change-orders/{rejected_void_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/change-orders/{rejected_void_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        rejected_blocked = self.client.patch(
            f"/api/v1/change-orders/{rejected_void_id}/",
            data={"amount_delta": "500.00"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(rejected_blocked, "co_edit_requires_draft_status")

        self.client.patch(
            f"/api/v1/change-orders/{rejected_void_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        void_blocked = self.client.patch(
            f"/api/v1/change-orders/{rejected_void_id}/",
            data={"title": "Attempted post-void edit"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(void_blocked, "co_edit_requires_draft_status")

    def test_change_order_clone_revision_requires_latest_revision(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        base_id = self._create_change_order(amount_delta="800.00")
        clone = self.client.post(
            f"/api/v1/change-orders/{base_id}/clone-revision/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)

        blocked = self.client.post(
            f"/api/v1/change-orders/{base_id}/clone-revision/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(blocked, "co_clone_requires_latest_revision")

    def test_change_order_clone_from_open_revision_auto_voids_source_revision(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        base_id = self._create_change_order(amount_delta="800.00")
        to_pending = self.client.patch(
            f"/api/v1/change-orders/{base_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_pending.status_code, 200)

        clone = self.client.post(
            f"/api/v1/change-orders/{base_id}/clone-revision/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)
        cloned_id = clone.json()["data"]["id"]

        source = ChangeOrder.objects.get(id=base_id)
        self.assertEqual(source.status, ChangeOrder.Status.VOID)

        snapshot = ChangeOrderSnapshot.objects.filter(
            change_order_id=base_id,
            decision_status=ChangeOrderSnapshot.DecisionStatus.VOID,
        ).latest("id")
        self.assertEqual(snapshot.snapshot_json["decision_context"]["previous_status"], "pending_approval")
        self.assertEqual(snapshot.snapshot_json["decision_context"]["applied_financial_delta"], "0.00")

        supersede_event = FinancialAuditEvent.objects.filter(
            object_type="change_order",
            object_id=base_id,
            to_status=ChangeOrder.Status.VOID,
        ).latest("id")
        self.assertIn("Superseded by", supersede_event.note)
        self.assertEqual(
            supersede_event.metadata_json.get("superseded_by_change_order_id"),
            cloned_id,
        )

    def test_change_order_approved_status_creates_immutable_snapshot(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        budget_line = self._active_budget_line()
        self.assertIsNotNone(budget_line)

        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Snapshot CO",
                "amount_delta": "250.00",
                "days_delta": 1,
                "reason": "Snapshot test",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Snapshot line",
                        "amount_delta": "250.00",
                        "days_delta": 1,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        change_order_id = create.json()["data"]["id"]

        self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        approve = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approve.status_code, 200)

        snapshots = ChangeOrderSnapshot.objects.filter(change_order_id=change_order_id)
        self.assertEqual(snapshots.count(), 1)
        snapshot = snapshots.get()
        self.assertEqual(snapshot.decision_status, ChangeOrderSnapshot.DecisionStatus.APPROVED)
        self.assertEqual(snapshot.decided_by_id, self.user.id)
        self.assertEqual(snapshot.snapshot_json["change_order"]["status"], "approved")
        self.assertEqual(snapshot.snapshot_json["change_order"]["amount_delta"], "250.00")
        self.assertEqual(snapshot.snapshot_json["decision_context"]["previous_status"], "pending_approval")
        self.assertEqual(snapshot.snapshot_json["decision_context"]["applied_financial_delta"], "250.00")
        self.assertEqual(len(snapshot.snapshot_json["line_items"]), 1)
        self.assertEqual(snapshot.snapshot_json["line_items"][0]["budget_line_id"], budget_line.id)

    def test_change_order_rejected_and_void_status_each_create_decision_snapshots(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        change_order_id = self._create_change_order(amount_delta="500.00")

        self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "pending_approval"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        rejected = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(rejected.status_code, 200)

        snapshots = ChangeOrderSnapshot.objects.filter(change_order_id=change_order_id).order_by("created_at", "id")
        self.assertEqual(snapshots.count(), 1)
        rejected_snapshot = snapshots.first()
        self.assertEqual(rejected_snapshot.decision_status, ChangeOrderSnapshot.DecisionStatus.REJECTED)
        self.assertEqual(rejected_snapshot.decided_by_id, self.user.id)
        self.assertEqual(rejected_snapshot.snapshot_json["change_order"]["status"], "rejected")
        self.assertEqual(rejected_snapshot.snapshot_json["decision_context"]["previous_status"], "pending_approval")
        self.assertEqual(rejected_snapshot.snapshot_json["decision_context"]["applied_financial_delta"], "0.00")

        voided = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(voided.status_code, 200)
        snapshots = ChangeOrderSnapshot.objects.filter(change_order_id=change_order_id).order_by("created_at", "id")
        self.assertEqual(snapshots.count(), 2)
        void_snapshot = snapshots.last()
        self.assertEqual(void_snapshot.decision_status, ChangeOrderSnapshot.DecisionStatus.VOID)
        self.assertEqual(void_snapshot.decided_by_id, self.user.id)
        self.assertEqual(void_snapshot.snapshot_json["change_order"]["status"], "void")
        self.assertEqual(void_snapshot.snapshot_json["decision_context"]["previous_status"], "rejected")
        self.assertEqual(void_snapshot.snapshot_json["decision_context"]["applied_financial_delta"], "0.00")

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
                "origin_estimate": self.last_approved_estimate_by_project[self.other_project.id],
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

    def test_approved_change_order_cannot_transition_to_void_and_financials_remain(self):
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
        self._assert_validation_rule(to_void, "co_status_transition_not_allowed")

        change_order_row = ChangeOrder.objects.get(id=change_order_id)
        self.assertIsNotNone(change_order_row.approved_by_id)
        self.assertIsNotNone(change_order_row.approved_at)
        self.assertFalse(
            ChangeOrderSnapshot.objects.filter(
                change_order_id=change_order_id,
                decision_status=ChangeOrderSnapshot.DecisionStatus.VOID,
            ).exists()
        )

        self.project.refresh_from_db()
        active_budget = self._active_budget()
        self.assertEqual(str(self.project.contract_value_current), "101200.00")
        self.assertEqual(str(active_budget.approved_change_order_total), "1200.00")

    def test_editing_approved_change_order_amount_is_blocked(self):
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
        self._assert_validation_rule(amount_update, "co_edit_requires_draft_status")

        self.project.refresh_from_db()
        active_budget = self._active_budget()
        self.assertEqual(str(self.project.contract_value_current), "100900.00")
        self.assertEqual(str(active_budget.approved_change_order_total), "900.00")

    def test_approved_change_order_line_deltas_are_exposed_on_budget_lines(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        budget_line = self._active_budget_line()
        self.assertIsNotNone(budget_line)

        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Line Coupling Visibility CO",
                "amount_delta": "250.00",
                "days_delta": 1,
                "reason": "Line-level approved coupling visibility",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Line-level coupling",
                        "amount_delta": "250.00",
                        "days_delta": 1,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        change_order_id = create.json()["data"]["id"]

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

        budgets_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/budgets/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(budgets_response.status_code, 200)
        line_payload = budgets_response.json()["data"][0]["line_items"][0]
        self.assertEqual(line_payload["approved_change_order_delta"], "250.00")
        self.assertEqual(line_payload["current_working_amount"], "1250.00")

    def test_editing_approved_change_order_line_coupling_and_void_are_blocked(self):
        self._create_active_budget(
            project_id=self.project.id,
            cost_code_id=self.cost_code.id,
            token=self.token.key,
        )
        budget_line = self._active_budget_line()
        self.assertIsNotNone(budget_line)

        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/change-orders/",
            data={
                "title": "Line Coupling Edit CO",
                "amount_delta": "300.00",
                "days_delta": 1,
                "reason": "Line-level coupling edit",
                "origin_estimate": self.last_approved_estimate_by_project[self.project.id],
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Line-level coupling edit",
                        "amount_delta": "300.00",
                        "days_delta": 1,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        change_order_id = create.json()["data"]["id"]

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

        edit = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={
                "amount_delta": "500.00",
                "line_items": [
                    {
                        "budget_line": budget_line.id,
                        "description": "Line-level coupling edit",
                        "amount_delta": "500.00",
                        "days_delta": 1,
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(edit, "co_edit_requires_draft_status")

        mid_budgets_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/budgets/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(mid_budgets_response.status_code, 200)
        mid_line_payload = mid_budgets_response.json()["data"][0]["line_items"][0]
        self.assertEqual(mid_line_payload["approved_change_order_delta"], "300.00")
        self.assertEqual(mid_line_payload["current_working_amount"], "1300.00")

        void_response = self.client.patch(
            f"/api/v1/change-orders/{change_order_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self._assert_validation_rule(void_response, "co_status_transition_not_allowed")

        final_budgets_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/budgets/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(final_budgets_response.status_code, 200)
        final_line_payload = final_budgets_response.json()["data"][0]["line_items"][0]
        self.assertEqual(final_line_payload["approved_change_order_delta"], "300.00")
        self.assertEqual(final_line_payload["current_working_amount"], "1300.00")
