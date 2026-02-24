from unittest.mock import patch

from django.core.exceptions import ValidationError

from core.tests.common import *


class ContactsManagementTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm_contacts",
            email="pm_contacts@example.com",
            password="secret123",
        )
        self.other = User.objects.create_user(
            username="pm_contacts_other",
            email="pm_contacts_other@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

        self.customer = Customer.objects.create(
            display_name="Alice Customer",
            phone="555-7777",
            billing_address="44 Test Ave",
            email="alice@example.com",
            created_by=self.user,
        )
        self.other_customer = Customer.objects.create(
            display_name="Other Customer",
            phone="555-2222",
            billing_address="Other St",
            email="other@example.com",
            created_by=self.other,
        )
        self.lead = LeadContact.objects.create(
            full_name="Lead For Audit",
            phone="555-0100",
            project_address="10 Lead St",
            email="lead@example.com",
            created_by=self.user,
        )

    def test_contacts_list_requires_authentication(self):
        response = self.client.get("/api/v1/customers/")
        self.assertEqual(response.status_code, 401)

    def test_contacts_list_legacy_alias_still_works(self):
        response = self.client.get(
            "/api/v1/contacts/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)

    def test_contacts_list_returns_user_scoped_rows(self):
        response = self.client.get(
            "/api/v1/customers/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], self.customer.id)
        self.assertEqual(rows[0]["display_name"], "Alice Customer")

    def test_contacts_list_supports_search(self):
        response = self.client.get(
            "/api/v1/customers/?q=Alice",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], self.customer.id)

    def test_contacts_list_project_count_excludes_prospect_projects(self):
        Project.objects.create(
            customer=self.customer,
            name="Prospect Shell",
            status=Project.Status.PROSPECT,
            contract_value_original=0,
            contract_value_current=0,
            created_by=self.user,
        )

        response = self.client.get(
            "/api/v1/customers/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        row = response.json()["data"][0]
        self.assertEqual(row["project_count"], 0)
        self.assertEqual(row["has_project"], False)

    def test_contact_patch_updates_record(self):
        response = self.client.patch(
            f"/api/v1/customers/{self.customer.id}/",
            data={
                "phone": "",
                "email": "alice-updated@example.com",
                "display_name": "Alice Updated",
                "billing_address": "55 Updated Ave",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.phone, "")
        self.assertEqual(self.customer.email, "alice-updated@example.com")
        self.assertEqual(self.customer.display_name, "Alice Updated")
        self.assertEqual(self.customer.billing_address, "55 Updated Ave")
        record = CustomerRecord.objects.get(customer_id=self.customer.id)
        self.assertEqual(record.event_type, CustomerRecord.EventType.UPDATED)

    def test_contact_patch_requires_phone_or_email(self):
        response = self.client.patch(
            f"/api/v1/customers/{self.customer.id}/",
            data={"phone": "", "email": ""},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("phone", payload)
        self.assertIn("email", payload)

    def test_contact_patch_can_toggle_archive_flag(self):
        response = self.client.patch(
            f"/api/v1/customers/{self.customer.id}/",
            data={"is_archived": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)

        self.customer.refresh_from_db()
        self.assertTrue(self.customer.is_archived)
        record = CustomerRecord.objects.get(customer_id=self.customer.id)
        self.assertEqual(record.event_type, CustomerRecord.EventType.UPDATED)
        self.assertEqual(record.metadata_json.get("from_is_archived"), False)
        self.assertEqual(record.metadata_json.get("to_is_archived"), True)

    def test_contact_patch_rejects_archive_when_customer_has_active_project(self):
        Project.objects.create(
            customer=self.customer,
            name="Guarded Project",
            site_address="11 Guard Ln",
            status=Project.Status.ACTIVE,
            contract_value_original=0,
            contract_value_current=0,
            created_by=self.user,
        )

        response = self.client.patch(
            f"/api/v1/customers/{self.customer.id}/",
            data={"is_archived": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("is_archived", payload)

        self.customer.refresh_from_db()
        self.assertFalse(self.customer.is_archived)

    def test_contact_patch_allows_archive_when_customer_projects_are_closed(self):
        Project.objects.create(
            customer=self.customer,
            name="Completed Project",
            site_address="44 Closed Ln",
            status=Project.Status.COMPLETED,
            contract_value_original=0,
            contract_value_current=0,
            created_by=self.user,
        )

        response = self.client.patch(
            f"/api/v1/customers/{self.customer.id}/",
            data={"is_archived": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)

        self.customer.refresh_from_db()
        self.assertTrue(self.customer.is_archived)

    def test_contact_detail_is_user_scoped(self):
        response = self.client.get(
            f"/api/v1/customers/{self.other_customer.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 404)

    def test_contact_delete_removes_record(self):
        response = self.client.delete(
            f"/api/v1/customers/{self.customer.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Customer.objects.filter(id=self.customer.id).exists())
        record = CustomerRecord.objects.get(event_type=CustomerRecord.EventType.DELETED)
        self.assertEqual(record.capture_source, CustomerRecord.CaptureSource.MANUAL_UI)
        self.assertIsNone(record.customer_id)

    def test_contact_delete_rejects_when_projects_still_reference_customer(self):
        Project.objects.create(
            customer=self.customer,
            name="Project Preventing Delete",
            status=Project.Status.PROSPECT,
            contract_value_original=0,
            contract_value_current=0,
            created_by=self.user,
        )

        response = self.client.delete(
            f"/api/v1/customers/{self.customer.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Customer.objects.filter(id=self.customer.id).exists())
        self.assertFalse(
            CustomerRecord.objects.filter(event_type=CustomerRecord.EventType.DELETED).exists()
        )

    def test_contact_delete_is_user_scoped(self):
        response = self.client.delete(
            f"/api/v1/customers/{self.other_customer.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Customer.objects.filter(id=self.other_customer.id).exists())

    def test_lead_contact_and_customer_records_are_immutable(self):
        lead_record = LeadContactRecord.objects.create(
            lead_contact=self.lead,
            event_type=LeadContactRecord.EventType.UPDATED,
            capture_source=LeadContactRecord.CaptureSource.SYSTEM,
            from_status=None,
            to_status=None,
            snapshot_json={"lead_contact": {"id": self.lead.id}},
            metadata_json={},
            recorded_by=self.user,
        )
        customer_record = CustomerRecord.objects.create(
            customer=self.customer,
            event_type=CustomerRecord.EventType.UPDATED,
            capture_source=CustomerRecord.CaptureSource.SYSTEM,
            snapshot_json={"customer": {"id": self.customer.id}},
            metadata_json={},
            recorded_by=self.user,
        )

        lead_record.note = "edited"
        with self.assertRaises(ValidationError):
            lead_record.save()
        with self.assertRaises(ValidationError):
            lead_record.delete()
        with self.assertRaises(ValidationError):
            LeadContactRecord.objects.filter(pk=lead_record.pk).delete()

        customer_record.note = "edited"
        with self.assertRaises(ValidationError):
            customer_record.save()
        with self.assertRaises(ValidationError):
            customer_record.delete()
        with self.assertRaises(ValidationError):
            CustomerRecord.objects.filter(pk=customer_record.pk).delete()

    def test_contact_delete_rolls_back_when_record_capture_fails(self):
        with patch(
            "core.views.shared_operations.intake._record_customer_record",
            side_effect=RuntimeError("capture-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.delete(
                    f"/api/v1/customers/{self.customer.id}/",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertTrue(Customer.objects.filter(id=self.customer.id).exists())

    def test_contact_patch_rejects_project_activation_when_customer_archived(self):
        self.customer.is_archived = True
        self.customer.save(update_fields=["is_archived", "updated_at"])
        project = Project.objects.create(
            customer=self.customer,
            name="Archived Customer Project",
            status=Project.Status.PROSPECT,
            contract_value_original=0,
            contract_value_current=0,
            created_by=self.user,
        )

        response = self.client.patch(
            f"/api/v1/projects/{project.id}/",
            data={"status": Project.Status.ACTIVE},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload["error"]["code"], "validation_error")
        self.assertIn("status", payload["error"]["fields"])
