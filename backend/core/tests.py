from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token

from core.models import CostCode, Customer, Estimate, EstimateStatusEvent, LeadContact, Project

User = get_user_model()

class HealthEndpointTests(TestCase):
    def test_health_endpoint_returns_ok_payload(self):
        response = self.client.get("/api/v1/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"data": {"status": "ok"}})


class AuthEndpointTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm",
            email="pm@example.com",
            password="secret123",
        )

    def test_me_endpoint_rejects_unauthenticated_request(self):
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.status_code, 401)

    def test_login_returns_token_and_me_works_with_token(self):
        login_response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "pm@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)
        token = login_response.json()["data"]["token"]
        self.assertTrue(token)

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["data"]["email"], "pm@example.com")


class LeadContactQuickAddTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm2",
            email="pm2@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

    def test_quick_add_requires_authentication(self):
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_quick_add_creates_lead_contact_with_required_fields(self):
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "source": "field_manual",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(LeadContact.objects.count(), 1)
        lead = LeadContact.objects.first()
        self.assertEqual(lead.created_by_id, self.user.id)
        self.assertEqual(lead.full_name, "Jane Doe")

    def test_quick_add_returns_duplicate_candidates_without_resolution(self):
        existing = LeadContact.objects.create(
            full_name="Existing Contact",
            phone="555-0100",
            project_address="12 Existing St",
            email="existing@example.com",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "5550100",
                "project_address": "123 Main St",
                "email": "existing@example.com",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "duplicate_detected")
        self.assertEqual(payload["data"]["duplicate_candidates"][0]["id"], existing.id)

    def test_quick_add_create_anyway_allows_duplicate_creation(self):
        LeadContact.objects.create(
            full_name="Existing Contact",
            phone="555-0100",
            project_address="12 Existing St",
            email="existing@example.com",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "email": "existing@example.com",
                "duplicate_resolution": "create_anyway",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(LeadContact.objects.count(), 2)
        self.assertEqual(response.json()["meta"]["duplicate_resolution"], "create_anyway")

    def test_quick_add_use_existing_returns_existing_record_without_creating(self):
        existing = LeadContact.objects.create(
            full_name="Existing Contact",
            phone="555-0100",
            project_address="12 Existing St",
            email="existing@example.com",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "email": "existing@example.com",
                "duplicate_resolution": "use_existing",
                "duplicate_target_id": existing.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(LeadContact.objects.count(), 1)
        self.assertEqual(response.json()["data"]["id"], existing.id)
        self.assertEqual(response.json()["meta"]["duplicate_resolution"], "use_existing")

    def test_quick_add_merge_existing_updates_existing_record_without_creating(self):
        existing = LeadContact.objects.create(
            full_name="Existing Contact",
            phone="555-0100",
            project_address="12 Existing St",
            email="existing@example.com",
            notes="Old note",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "email": "existing@example.com",
                "notes": "New note",
                "duplicate_resolution": "merge_existing",
                "duplicate_target_id": existing.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(LeadContact.objects.count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.full_name, "Jane Doe")
        self.assertEqual(existing.project_address, "123 Main St")
        self.assertIn("Old note", existing.notes)
        self.assertIn("New note", existing.notes)


class LeadConversionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm3",
            email="pm3@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.lead = LeadContact.objects.create(
            full_name="Owner Name",
            phone="555-9999",
            project_address="321 Build St",
            email="owner@example.com",
            created_by=self.user,
        )

    def test_convert_requires_authentication(self):
        response = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_convert_creates_customer_and_project_shell(self):
        response = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={"project_name": "Kitchen Remodel", "project_status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Customer.objects.count(), 1)
        self.assertEqual(Project.objects.count(), 1)

        self.lead.refresh_from_db()
        self.assertEqual(self.lead.status, LeadContact.Status.PROJECT_CREATED)
        self.assertIsNotNone(self.lead.converted_customer_id)
        self.assertIsNotNone(self.lead.converted_project_id)
        self.assertEqual(response.json()["meta"]["conversion_status"], "converted")

    def test_convert_is_idempotent_if_already_converted(self):
        first = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={"project_name": "Kitchen Remodel"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)

        second = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={"project_name": "Ignored Name"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["meta"]["conversion_status"], "already_converted")
        self.assertEqual(Customer.objects.count(), 1)
        self.assertEqual(Project.objects.count(), 1)


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
                "contract_value_original": "125000.00",
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
        self.assertEqual(str(self.project.contract_value_original), "125000.00")
        self.assertEqual(str(self.project.contract_value_current), "130000.00")
        self.assertEqual(str(self.project.start_date_planned), "2026-03-01")
        self.assertEqual(str(self.project.end_date_planned), "2026-07-31")


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
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

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
