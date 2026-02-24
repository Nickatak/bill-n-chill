from unittest.mock import patch

from core.tests.common import *


class CustomerIntakeQuickAddTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm2",
            email="pm2@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

    def test_quick_add_requires_authentication(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_quick_add_creates_customer_and_intake_provenance_with_required_fields(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
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
        self.assertEqual(Customer.objects.count(), 1)
        customer = Customer.objects.first()
        intake_payload = response.json()["data"]["customer_intake"]
        self.assertEqual(intake_payload["full_name"], "Jane Doe")
        self.assertEqual(customer.display_name, "Jane Doe")
        self.assertEqual(customer.phone, "555-0100")

        record = LeadContactRecord.objects.get(
            event_type=LeadContactRecord.EventType.CREATED,
        )
        self.assertEqual(record.capture_source, LeadContactRecord.CaptureSource.MANUAL_UI)
        self.assertIn("customer_intake", record.snapshot_json)
        customer_record = CustomerRecord.objects.get(customer_id=customer.id)
        self.assertEqual(customer_record.event_type, CustomerRecord.EventType.CREATED)

    def test_quick_add_accepts_optional_initial_contract_value(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "Valued Intake",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "initial_contract_value": "25000.00",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.json()["data"]["customer_intake"]["initial_contract_value"],
            "25000.00",
        )

    def test_quick_add_allows_email_in_phone_field(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "Email Only",
                "phone": "email-only@example.com",
                "project_address": "99 Email St",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        customer = Customer.objects.get(id=response.json()["data"]["customer"]["id"])
        intake_payload = response.json()["data"]["customer_intake"]
        self.assertEqual(intake_payload["phone"], "")
        self.assertEqual(intake_payload["email"], "email-only@example.com")
        self.assertEqual(customer.phone, "")
        self.assertEqual(customer.email, "email-only@example.com")

    def test_quick_add_rejects_when_phone_and_email_are_missing(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "No Contact Method",
                "project_address": "100 Missing Contact St",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("phone", payload)

    def test_quick_add_rejects_invalid_contact_method_in_phone_field(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "Bad Contact",
                "phone": "not-a-phone-and-not-an-email",
                "project_address": "100 Invalid Contact St",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("phone", payload)

    def test_quick_add_returns_duplicate_candidates_without_resolution(self):
        existing = Customer.objects.create(
            display_name="Existing Customer",
            phone="555-0100",
            billing_address="12 Existing St",
            email="existing@example.com",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/customers/quick-add/",
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

    def test_quick_add_create_anyway_allows_duplicate_customer_creation(self):
        Customer.objects.create(
            display_name="Existing Customer",
            phone="555-0100",
            billing_address="12 Existing St",
            email="existing@example.com",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/customers/quick-add/",
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
        self.assertEqual(Customer.objects.count(), 2)
        self.assertEqual(response.json()["meta"]["duplicate_resolution"], "create_anyway")

    def test_quick_add_use_existing_reuses_customer(self):
        existing = Customer.objects.create(
            display_name="Existing Customer",
            phone="555-0100",
            billing_address="12 Existing St",
            email="existing@example.com",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/customers/quick-add/",
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
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Customer.objects.count(), 1)
        self.assertEqual(response.json()["data"]["customer"]["id"], existing.id)
        self.assertEqual(response.json()["meta"]["duplicate_resolution"], "use_existing")
        self.assertEqual(response.json()["meta"]["customer_created"], False)

    def test_quick_add_merge_existing_is_rejected(self):
        existing = Customer.objects.create(
            display_name="Existing Customer",
            phone="555-0100",
            billing_address="12 Existing St",
            email="existing@example.com",
            created_by=self.user,
        )
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "email": "existing@example.com",
                "duplicate_resolution": "merge_existing",
                "duplicate_target_id": existing.id,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "duplicate_detected")
        self.assertNotIn("merge_existing", payload["data"]["allowed_resolutions"])

    def test_quick_add_can_create_project_in_same_request(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "create_project": True,
                "project_name": "Kitchen Remodel",
                "project_status": "active",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Customer.objects.count(), 1)
        self.assertEqual(Project.objects.count(), 1)
        payload = response.json()
        self.assertEqual(payload["meta"]["conversion_status"], "converted")
        self.assertIsNotNone(payload["data"]["project"])
        project = Project.objects.get(id=payload["data"]["project"]["id"])
        self.assertEqual(project.status, Project.Status.ACTIVE)
        self.assertEqual(payload["data"]["customer_intake"]["converted_project"], project.id)
        self.assertIsNotNone(payload["data"]["customer_intake"]["converted_customer"])
        converted_record = LeadContactRecord.objects.filter(
            intake_record_id=payload["data"]["customer_intake"]["id"],
            event_type=LeadContactRecord.EventType.CONVERTED,
        ).latest("id")
        self.assertEqual(
            converted_record.metadata_json.get("project_status_requested"),
            Project.Status.ACTIVE,
        )
        self.assertEqual(
            converted_record.metadata_json.get("project_status_created_as"),
            Project.Status.PROSPECT,
        )
        self.assertEqual(
            converted_record.metadata_json.get("project_status_final"),
            Project.Status.ACTIVE,
        )
        self.assertEqual(
            converted_record.metadata_json.get("project_status_transition"),
            "prospect_to_active",
        )

    def test_quick_add_rejects_non_prospect_or_active_project_status(self):
        response = self.client.post(
            "/api/v1/customers/quick-add/",
            data={
                "full_name": "Jane Doe",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "create_project": True,
                "project_name": "Kitchen Remodel",
                "project_status": Project.Status.ON_HOLD,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("project_status", payload["error"]["fields"])

    def test_quick_add_rolls_back_when_record_capture_fails(self):
        with patch(
            "core.views.shared_operations.intake._record_customer_intake_record",
            side_effect=RuntimeError("capture-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    "/api/v1/customers/quick-add/",
                    data={
                        "full_name": "Rollback Intake",
                        "phone": "555-0102",
                        "project_address": "124 Main St",
                    },
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertFalse(Customer.objects.filter(display_name="Rollback Intake").exists())
        self.assertEqual(LeadContactRecord.objects.count(), 0)
