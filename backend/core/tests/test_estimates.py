from datetime import timedelta

from django.utils import timezone

from core.serializers import EstimateWriteSerializer
from core.tests.common import *

class EstimateTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm8",
            email="pm8@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm9",
            email="pm9@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

        self.customer = Customer.objects.create(
            display_name="Owner C",
            email="ownerc@example.com",
            phone="555-3333",
            billing_address="3 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Estimate Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )
        self.second_project = Project.objects.create(
            customer=self.customer,
            name="Second Property Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            display_name="Owner D",
            email="ownerd@example.com",
            phone="555-4444",
            billing_address="4 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            customer=other_customer,
            name="Other Estimate Project",
            status=Project.Status.PROSPECT,
            created_by=self.other_user,
        )

        self.cost_code = CostCode.objects.create(
            code="01-100",
            name="General Conditions",
            is_active=True,
            created_by=self.user,
        )

    def _bootstrap_primary_membership(self):
        response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "pm8@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        return OrganizationMembership.objects.select_related("organization").get(user=self.user)

    def test_public_estimate_detail_view_allows_unauthenticated_access(self):
        estimate = Estimate.objects.create(
            project=self.project,
            version=1,
            title="Public Estimate",
            created_by=self.user,
            status=Estimate.Status.SENT,
        )
        EstimateLineItem.objects.create(
            estimate=estimate,
            cost_code=self.cost_code,
            description="Demo and prep",
            quantity="2",
            unit="day",
            unit_cost="500",
            markup_percent="10",
            line_total="1100",
        )

        response = self.client.get(f"/api/v1/public/estimates/{estimate.public_token}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["id"], estimate.id)
        self.assertEqual(payload["title"], "Public Estimate")
        self.assertTrue(payload["public_ref"].endswith(f"--{estimate.public_token}"))
        self.assertEqual(payload["project_context"]["id"], self.project.id)
        self.assertEqual(
            payload["project_context"]["customer_display_name"],
            self.customer.display_name,
        )
        self.assertEqual(len(payload["line_items"]), 1)

    def test_public_estimate_detail_view_not_found(self):
        response = self.client.get("/api/v1/public/estimates/notarealtoken/")
        self.assertEqual(response.status_code, 404)

    def test_estimate_contract_requires_authentication(self):
        response = self.client.get("/api/v1/contracts/estimates/")
        self.assertEqual(response.status_code, 401)

    def test_estimate_contract_matches_model_transition_policy(self):
        response = self.client.get(
            "/api/v1/contracts/estimates/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]

        expected_statuses = [status for status, _label in Estimate.Status.choices]
        expected_labels = {status: label for status, label in Estimate.Status.choices}
        expected_transitions = {}
        for status in expected_statuses:
            next_statuses = list(Estimate.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
            next_statuses.sort(key=lambda value: expected_statuses.index(value))
            expected_transitions[status] = next_statuses
        expected_terminal_statuses = [
            status for status in expected_statuses if not expected_transitions.get(status, [])
        ]

        self.assertEqual(payload["statuses"], expected_statuses)
        self.assertEqual(payload["status_labels"], expected_labels)
        self.assertEqual(payload["default_create_status"], Estimate.Status.DRAFT)
        self.assertEqual(
            payload["default_status_filters"],
            [
                Estimate.Status.DRAFT,
                Estimate.Status.SENT,
                Estimate.Status.APPROVED,
                Estimate.Status.REJECTED,
            ],
        )
        self.assertEqual(payload["allowed_status_transitions"], expected_transitions)
        self.assertEqual(payload["terminal_statuses"], expected_terminal_statuses)
        self.assertEqual(
            payload["quick_action_by_status"],
            {
                Estimate.Status.APPROVED: "change_order",
                Estimate.Status.REJECTED: "revision",
                Estimate.Status.VOID: "revision",
            },
        )
        self.assertTrue(str(payload["policy_version"]).startswith("2026-02-24.estimates."))

    def test_project_estimates_create(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "tax_percent": "8.25",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "2",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "10",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Estimate.objects.count(), 1)
        estimate = Estimate.objects.first()
        self.assertEqual(estimate.version, 1)
        self.assertEqual(str(estimate.subtotal), "1000.00")
        self.assertEqual(str(estimate.markup_total), "100.00")

    def test_project_estimates_create_persists_valid_through(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Estimate With Valid Through",
                "valid_through": "2026-06-30",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["valid_through"], "2026-06-30")

        estimate = Estimate.objects.get(id=payload["id"])
        self.assertEqual(str(estimate.valid_through), "2026-06-30")

    def test_project_estimates_create_uses_organization_validation_delta_when_valid_through_omitted(self):
        membership = self._bootstrap_primary_membership()
        membership.organization.estimate_validation_delta_days = 14
        membership.organization.save(update_fields=["estimate_validation_delta_days", "updated_at"])

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Estimate Uses Validation Delta",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        expected_valid_through = timezone.localdate() + timedelta(days=14)
        self.assertEqual(payload["valid_through"], expected_valid_through.isoformat())

        estimate = Estimate.objects.get(id=payload["id"])
        self.assertEqual(estimate.valid_through, expected_valid_through)

    def test_project_estimates_create_uses_organization_default_terms_when_omitted(self):
        membership = self._bootstrap_primary_membership()
        membership.organization.estimate_default_terms = "Org default estimate terms."
        membership.organization.save(update_fields=["estimate_default_terms", "updated_at"])

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Estimate Default Terms",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["terms_text"], "Org default estimate terms.")

    def test_project_estimates_rejects_per_estimate_terms_overrides(self):
        self._bootstrap_primary_membership()
        create_with_override = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Estimate Terms Override",
                "terms_text": "Custom estimate terms v1.",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create_with_override.status_code, 400)
        self.assertEqual(create_with_override.json()["error"]["code"], "validation_error")
        self.assertIn("terms_text", create_with_override.json()["error"]["fields"])

        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Estimate Terms Base",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        estimate_id = create.json()["data"]["id"]

        patch = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"terms_text": "Custom estimate terms v2."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(patch.status_code, 400)
        self.assertEqual(patch.json()["error"]["code"], "validation_error")
        self.assertIn("terms_text", patch.json()["error"]["fields"])

    def test_project_estimates_patch_rejects_terms_edit_when_non_draft(self):
        self._bootstrap_primary_membership()
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Locked Terms",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        locked_patch = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"terms_text": "Cannot change once sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(locked_patch.status_code, 400)
        self.assertEqual(locked_patch.json()["error"]["code"], "validation_error")
        self.assertIn("terms_text", locked_patch.json()["error"]["fields"])

    def test_project_estimates_create_rounds_tax_half_up_to_cents(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Rounding Estimate",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Tiny taxable line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "0.05",
                        "markup_percent": "0.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["subtotal"], "0.05")
        self.assertEqual(payload["tax_total"], "0.01")
        self.assertEqual(payload["grand_total"], "0.06")

    def test_project_estimates_create_reuses_scope_item_for_normalized_line_identity(self):
        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Scope Identity A",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and Prep",
                        "quantity": "1",
                        "unit": "EA",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)

        second = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Scope Identity B",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "  demo   and prep  ",
                        "quantity": "2",
                        "unit": "ea",
                        "unit_cost": "250",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second.status_code, 201)

        first_line = EstimateLineItem.objects.get(estimate_id=first.json()["data"]["id"])
        second_line = EstimateLineItem.objects.get(estimate_id=second.json()["data"]["id"])
        self.assertIsNotNone(first_line.scope_item_id)
        self.assertEqual(first_line.scope_item_id, second_line.scope_item_id)
        self.assertEqual(ScopeItem.objects.count(), 1)

    def test_project_estimates_create_creates_distinct_scope_items_for_different_units(self):
        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Unit Identity A",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Bleach",
                        "quantity": "1",
                        "unit": "1gal",
                        "unit_cost": "20",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)

        second = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Unit Identity B",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "bleach",
                        "quantity": "1",
                        "unit": "5gal",
                        "unit_cost": "80",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second.status_code, 201)

        first_line = EstimateLineItem.objects.get(estimate_id=first.json()["data"]["id"])
        second_line = EstimateLineItem.objects.get(estimate_id=second.json()["data"]["id"])
        self.assertIsNotNone(first_line.scope_item_id)
        self.assertIsNotNone(second_line.scope_item_id)
        self.assertNotEqual(first_line.scope_item_id, second_line.scope_item_id)
        self.assertEqual(ScopeItem.objects.count(), 2)

    def test_project_estimates_create_creates_distinct_scope_items_for_different_cost_codes(self):
        alt_cost_code = CostCode.objects.create(
            code="01-200",
            name="Temporary Facilities",
            is_active=True,
            created_by=self.user,
        )

        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "CostCode Identity A",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo setup",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "100",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)

        second = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "CostCode Identity B",
                "line_items": [
                    {
                        "cost_code": alt_cost_code.id,
                        "description": "demo setup",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "100",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second.status_code, 201)

        first_line = EstimateLineItem.objects.get(estimate_id=first.json()["data"]["id"])
        second_line = EstimateLineItem.objects.get(estimate_id=second.json()["data"]["id"])
        self.assertIsNotNone(first_line.scope_item_id)
        self.assertIsNotNone(second_line.scope_item_id)
        self.assertNotEqual(first_line.scope_item_id, second_line.scope_item_id)
        self.assertEqual(ScopeItem.objects.count(), 2)

    def test_project_estimates_create_requires_title(self):
        missing = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(missing.status_code, 400)

        blank = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "   ",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blank.status_code, 400)

    def test_project_estimates_create_archives_previous_family(self):
        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Demo",
                "status": "sent",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)
        first_id = first.json()["data"]["id"]

        second = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Demo",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Prep and haul",
                        "quantity": "2",
                        "unit": "day",
                        "unit_cost": "450",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second.status_code, 201)

        first_estimate = Estimate.objects.get(id=first_id)
        self.assertEqual(first_estimate.status, Estimate.Status.ARCHIVED)
        self.assertTrue(
            EstimateStatusEvent.objects.filter(
                estimate_id=first_id,
                to_status=Estimate.Status.ARCHIVED,
            ).exists()
        )

    def test_project_estimates_create_rejects_user_archived_status(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Should Fail",
                "status": "archived",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["status"][0],
            "Archived status is system-controlled and cannot be set directly.",
        )

    def test_project_estimates_list_scoped_by_project_and_user(self):
        Estimate.objects.create(
            project=self.project,
            version=1,
            title="Mine",
            created_by=self.user,
        )
        Estimate.objects.create(
            project=self.other_project,
            version=1,
            title="Other",
            created_by=self.other_user,
        )
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/estimates/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Mine")

    def test_estimate_status_write_contract_distinguishes_void_from_archived(self):
        archived_serializer = EstimateWriteSerializer(
            data={
                "title": "Contract Test",
                "status": "archived",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "100.00",
                        "markup_percent": "0.00",
                    }
                ],
            }
        )
        self.assertFalse(archived_serializer.is_valid())
        self.assertIn("status", archived_serializer.errors)
        self.assertIn(
            "Archived status is system-controlled and cannot be set directly.",
            archived_serializer.errors["status"],
        )

        void_serializer = EstimateWriteSerializer(
            data={
                "title": "Contract Test",
                "status": "void",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_cost": "100.00",
                        "markup_percent": "0.00",
                    }
                ],
            }
        )
        self.assertTrue(void_serializer.is_valid(), void_serializer.errors)
        self.assertEqual(void_serializer.validated_data["status"], Estimate.Status.VOID)

    def test_estimate_clone_creates_next_version(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)
        self.assertEqual(Estimate.objects.filter(project=self.project).count(), 2)
        latest = Estimate.objects.filter(project=self.project).order_by("-version").first()
        self.assertEqual(latest.version, 2)
        self.assertEqual(latest.status, Estimate.Status.DRAFT)
        original = Estimate.objects.get(id=estimate_id)
        self.assertEqual(original.status, Estimate.Status.REJECTED)

    def test_estimate_clone_from_rejected_keeps_source_rejected(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Rejected Source",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        rejected = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(rejected.status_code, 200)

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)

        original = Estimate.objects.get(id=estimate_id)
        self.assertEqual(original.status, Estimate.Status.REJECTED)

    def test_estimate_clone_blocked_when_source_is_approved(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Approved Source",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 400)
        self.assertEqual(clone.json()["error"]["code"], "validation_error")

    def test_estimate_clone_blocked_when_source_is_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Draft Source",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 400)
        self.assertEqual(clone.json()["error"]["code"], "validation_error")

    def test_estimate_clone_allowed_when_source_is_archived(self):
        source = Estimate.objects.create(
            project=self.project,
            version=1,
            status=Estimate.Status.ARCHIVED,
            title="Archived Source",
            created_by=self.user,
        )

        clone = self.client.post(
            f"/api/v1/estimates/{source.id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)
        cloned = clone.json()["data"]
        self.assertEqual(cloned["status"], Estimate.Status.DRAFT)
        self.assertEqual(cloned["title"], source.title)

    def test_estimate_clone_allowed_when_source_is_void(self):
        source = Estimate.objects.create(
            project=self.project,
            version=1,
            status=Estimate.Status.VOID,
            title="Voided Source",
            created_by=self.user,
        )

        clone = self.client.post(
            f"/api/v1/estimates/{source.id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)
        cloned = clone.json()["data"]
        self.assertEqual(cloned["status"], Estimate.Status.DRAFT)
        self.assertEqual(cloned["title"], source.title)

    def test_estimate_status_transition_validates_allowed_paths(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        invalid = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")
        self.assertEqual(
            invalid.json()["error"]["message"],
            "Estimate must be sent before it can be approved or rejected.",
        )

        invalid_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_approved.status_code, 400)
        self.assertEqual(invalid_approved.json()["error"]["code"], "validation_error")
        self.assertEqual(
            invalid_approved.json()["error"]["message"],
            "Estimate must be sent before it can be approved or rejected.",
        )

        to_sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)
        self.assertEqual(to_sent.json()["data"]["status"], "sent")

        to_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)
        self.assertEqual(to_approved.json()["data"]["status"], "approved")
        self.assertEqual(Budget.objects.filter(source_estimate_id=estimate_id).count(), 1)

    def test_estimate_approval_auto_converts_to_budget_and_manual_convert_is_idempotent(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Auto Budget Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        estimate_id = create.json()["data"]["id"]

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
        self.assertEqual(Budget.objects.filter(source_estimate_id=estimate_id).count(), 1)
        self.project.refresh_from_db()
        self.assertEqual(str(self.project.contract_value_original), "500.00")
        self.assertEqual(str(self.project.contract_value_current), "500.00")

        convert = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(convert.status_code, 200)
        self.assertEqual(convert.json()["meta"]["conversion_status"], "already_converted")
        self.assertEqual(Budget.objects.filter(source_estimate_id=estimate_id).count(), 1)

    def test_estimate_approval_does_not_override_existing_project_contract_baseline(self):
        Project.objects.filter(id=self.project.id).update(
            contract_value_original="1000.00",
            contract_value_current="1000.00",
        )

        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "No Override Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        estimate_id = create.json()["data"]["id"]

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

        self.project.refresh_from_db()
        self.assertEqual(str(self.project.contract_value_original), "1000.00")
        self.assertEqual(str(self.project.contract_value_current), "1000.00")

    def test_estimate_status_transition_allows_sent_to_void(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Void Block",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        voided = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(voided.status_code, 200)
        self.assertEqual(voided.json()["data"]["status"], Estimate.Status.VOID)

        estimate = Estimate.objects.get(id=estimate_id)
        self.assertEqual(estimate.status, Estimate.Status.VOID)

    def test_estimate_status_transition_rejects_user_archived_patch(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Archived Patch Block",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        response = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "archived"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["status"][0],
            "Archived status is system-controlled and cannot be set directly.",
        )

    def test_estimate_status_transition_creates_audit_events(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent", "status_note": "Sent to owner for review."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "rejected", "status_note": "Owner requested adjustments."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        events = EstimateStatusEvent.objects.filter(estimate_id=estimate_id)
        self.assertEqual(events.count(), 3)
        latest = events.first()
        self.assertEqual(latest.from_status, Estimate.Status.SENT)
        self.assertEqual(latest.to_status, Estimate.Status.REJECTED)
        self.assertEqual(latest.note, "Owner requested adjustments.")

        response = self.client.get(
            f"/api/v1/estimates/{estimate_id}/status-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 3)

    def test_estimate_resend_records_sent_to_sent_status_event(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Resend Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent", "status_note": "Initial send."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        resent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent", "status_note": "Re-sent after follow-up call."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resent.status_code, 200)

        events = EstimateStatusEvent.objects.filter(estimate_id=estimate_id)
        self.assertEqual(events.count(), 3)
        latest = events.first()
        self.assertEqual(latest.from_status, Estimate.Status.SENT)
        self.assertEqual(latest.to_status, Estimate.Status.SENT)
        self.assertEqual(latest.note, "Re-sent after follow-up call.")

    def test_estimate_terminal_status_note_records_same_status_event(self):
        approved_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Approved Note Event Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        approved_estimate_id = approved_create.json()["data"]["id"]
        self.client.patch(
            f"/api/v1/estimates/{approved_estimate_id}/",
            data={"status": "sent", "status_note": "Sent for approval."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/estimates/{approved_estimate_id}/",
            data={"status": "approved", "status_note": "Approved by owner."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        approved_note = self.client.patch(
            f"/api/v1/estimates/{approved_estimate_id}/",
            data={"status": "approved", "status_note": "Final approved terms acknowledged."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved_note.status_code, 200)
        approved_events = EstimateStatusEvent.objects.filter(estimate_id=approved_estimate_id)
        approved_latest = approved_events.first()
        self.assertEqual(approved_latest.from_status, Estimate.Status.APPROVED)
        self.assertEqual(approved_latest.to_status, Estimate.Status.APPROVED)
        self.assertEqual(approved_latest.note, "Final approved terms acknowledged.")
        approved_history = self.client.get(
            f"/api/v1/estimates/{approved_estimate_id}/status-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved_history.status_code, 200)
        self.assertEqual(approved_history.json()["data"][0]["action_type"], "notate")

        void_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Void Note Event Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        void_estimate_id = void_create.json()["data"]["id"]
        self.client.patch(
            f"/api/v1/estimates/{void_estimate_id}/",
            data={"status": "sent", "status_note": "Sent to owner."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/estimates/{void_estimate_id}/",
            data={"status": "void", "status_note": "Voided after owner cancellation."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        void_note = self.client.patch(
            f"/api/v1/estimates/{void_estimate_id}/",
            data={"status": "void", "status_note": "Closed and archived for records."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(void_note.status_code, 200)
        void_events = EstimateStatusEvent.objects.filter(estimate_id=void_estimate_id)
        void_latest = void_events.first()
        self.assertEqual(void_latest.from_status, Estimate.Status.VOID)
        self.assertEqual(void_latest.to_status, Estimate.Status.VOID)
        self.assertEqual(void_latest.note, "Closed and archived for records.")

    def test_estimate_values_locked_after_send(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Lock After Send",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        locked = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"title": "New Title"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(locked.status_code, 400)

        locked_valid_through = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"valid_through": "2026-07-31"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(locked_valid_through.status_code, 400)

        approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)

    def test_estimate_title_cannot_change_after_creation_even_in_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Original Title",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        rename = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"title": "Renamed Title"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(rename.status_code, 400)
        self.assertEqual(rename.json()["error"]["code"], "validation_error")
        self.assertEqual(
            rename.json()["error"]["message"],
            "Estimate title cannot be changed after creation.",
        )

    def test_estimate_cannot_transition_from_sent_back_to_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "No Revert To Draft",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        invalid = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "draft"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

    def test_estimate_duplicate_creates_new_draft_without_archiving_source(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Estimate",
                "status": "sent",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        source_id = create.json()["data"]["id"]

        duplicated = self.client.post(
            f"/api/v1/estimates/{source_id}/duplicate/",
            data={
                "project_id": self.second_project.id,
                "title": "Kitchen Estimate - Property B",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicated.status_code, 201)
        duplicated_data = duplicated.json()["data"]
        self.assertEqual(duplicated_data["status"], Estimate.Status.DRAFT)
        self.assertEqual(duplicated_data["title"], "Kitchen Estimate - Property B")
        self.assertEqual(duplicated_data["project"], self.second_project.id)

        source = Estimate.objects.get(id=source_id)
        self.assertEqual(source.status, Estimate.Status.SENT)

    def test_estimate_duplicate_same_project_same_title_requires_revision_flow(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        source_id = create.json()["data"]["id"]

        invalid = self.client.post(
            f"/api/v1/estimates/{source_id}/duplicate/",
            data={
                "project_id": self.project.id,
                "title": "Kitchen Estimate",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

    def test_estimate_duplicate_new_titles_start_new_family_at_version_one(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Title",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        self.assertEqual(create.json()["data"]["version"], 1)
        source_id = create.json()["data"]["id"]

        duplicate_one = self.client.post(
            f"/api/v1/estimates/{source_id}/duplicate/",
            data={
                "project_id": self.project.id,
                "title": "Title2",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicate_one.status_code, 201)
        first_copy = duplicate_one.json()["data"]
        self.assertEqual(first_copy["title"], "Title2")
        self.assertEqual(first_copy["version"], 1)

        duplicate_two = self.client.post(
            f"/api/v1/estimates/{first_copy['id']}/duplicate/",
            data={
                "project_id": self.project.id,
                "title": "Title3",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicate_two.status_code, 201)
        second_copy = duplicate_two.json()["data"]
        self.assertEqual(second_copy["title"], "Title3")
        self.assertEqual(second_copy["version"], 1)
