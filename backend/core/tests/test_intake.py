from unittest.mock import patch

from core.tests.common import *

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
        record = LeadContactRecord.objects.get(lead_contact_id=lead.id)
        self.assertEqual(record.event_type, LeadContactRecord.EventType.CREATED)
        self.assertEqual(record.capture_source, LeadContactRecord.CaptureSource.MANUAL_UI)

    def test_quick_add_accepts_optional_initial_contract_value(self):
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Valued Lead",
                "phone": "555-0100",
                "project_address": "123 Main St",
                "initial_contract_value": "25000.00",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        lead = LeadContact.objects.get(id=response.json()["data"]["id"])
        self.assertEqual(str(lead.initial_contract_value), "25000.00")

    def test_quick_add_allows_email_in_phone_field(self):
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
            data={
                "full_name": "Email Only",
                "phone": "email-only@example.com",
                "project_address": "99 Email St",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        lead = LeadContact.objects.get(id=response.json()["data"]["id"])
        self.assertEqual(lead.phone, "")
        self.assertEqual(lead.email, "email-only@example.com")

    def test_quick_add_rejects_when_phone_and_email_are_missing(self):
        response = self.client.post(
            "/api/v1/lead-contacts/quick-add/",
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
            "/api/v1/lead-contacts/quick-add/",
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

    def test_quick_add_merge_existing_is_rejected(self):
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

    def test_quick_add_rolls_back_when_record_capture_fails(self):
        with patch(
            "core.views.shared_operations.intake._record_lead_contact_record",
            side_effect=RuntimeError("capture-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    "/api/v1/lead-contacts/quick-add/",
                    data={
                        "full_name": "Rollback Lead",
                        "phone": "555-0102",
                        "project_address": "124 Main St",
                    },
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertFalse(LeadContact.objects.filter(full_name="Rollback Lead").exists())


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
        project = Project.objects.get(id=self.lead.converted_project_id)
        self.assertIsNotNone(self.lead.converted_customer_id)
        self.assertIsNotNone(self.lead.converted_project_id)
        self.assertEqual(project.site_address, "321 Build St")
        self.assertEqual(response.json()["meta"]["conversion_status"], "converted")
        lead_record = LeadContactRecord.objects.get(lead_contact_id=self.lead.id)
        self.assertEqual(lead_record.event_type, LeadContactRecord.EventType.CONVERTED)
        self.assertIsNone(lead_record.from_status)
        self.assertIsNone(lead_record.to_status)
        customer_record = CustomerRecord.objects.get(customer_id=self.lead.converted_customer_id)
        self.assertEqual(customer_record.event_type, CustomerRecord.EventType.CREATED)
        self.assertEqual(customer_record.capture_source, CustomerRecord.CaptureSource.MANUAL_UI)

    def test_convert_uses_initial_contract_value_when_present(self):
        self.lead.initial_contract_value = "14500.00"
        self.lead.save(update_fields=["initial_contract_value", "updated_at"])

        response = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={"project_name": "Kitchen Remodel", "project_status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        project = Project.objects.get(id=response.json()["data"]["project"]["id"])
        self.assertEqual(str(project.contract_value_original), "14500.00")
        self.assertEqual(str(project.contract_value_current), "14500.00")

    def test_convert_rejects_archived_lead(self):
        self.lead.is_archived = True
        self.lead.save(update_fields=["is_archived", "updated_at"])

        response = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={"project_name": "Kitchen Remodel"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("is_archived", payload["error"]["fields"])
        self.assertEqual(Customer.objects.count(), 0)
        self.assertEqual(Project.objects.count(), 0)

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
        self.assertEqual(
            LeadContactRecord.objects.filter(
                lead_contact_id=self.lead.id,
                event_type=LeadContactRecord.EventType.CONVERTED,
            ).count(),
            1,
        )

    def test_convert_reused_customer_keeps_billing_address_and_sets_project_site_address(self):
        existing_customer = Customer.objects.create(
            display_name="Owner Name",
            email="owner@example.com",
            phone="555-9999",
            billing_address="777 Billing Blvd",
            created_by=self.user,
        )

        response = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={"project_name": "Property B"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)

        project = Project.objects.get(id=response.json()["data"]["project"]["id"])
        existing_customer.refresh_from_db()
        self.assertEqual(project.customer_id, existing_customer.id)
        self.assertEqual(project.site_address, "321 Build St")
        self.assertEqual(existing_customer.billing_address, "777 Billing Blvd")

    def test_convert_rejects_active_project_creation_for_archived_customer(self):
        existing_customer = Customer.objects.create(
            display_name="Owner Name",
            email="owner@example.com",
            phone="555-9999",
            billing_address="777 Billing Blvd",
            is_archived=True,
            created_by=self.user,
        )

        response = self.client.post(
            f"/api/v1/lead-contacts/{self.lead.id}/convert-to-project/",
            data={"project_name": "Blocked Project", "project_status": "active"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("status", payload["error"]["fields"])

        self.lead.refresh_from_db()
        self.assertIsNone(self.lead.converted_project_id)
        self.assertIsNone(self.lead.converted_customer_id)
        self.assertEqual(Project.objects.count(), 0)
        self.assertEqual(Customer.objects.filter(id=existing_customer.id).count(), 1)
