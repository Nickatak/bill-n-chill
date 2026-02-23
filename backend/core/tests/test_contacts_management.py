from core.tests.common import *
from django.core.exceptions import ValidationError
from unittest.mock import patch


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

        self.contact = LeadContact.objects.create(
            full_name="Alice Contact",
            phone="555-7777",
            project_address="44 Test Ave",
            email="alice@example.com",
            notes="Initial note",
            source=LeadContact.Source.FIELD_MANUAL,
            created_by=self.user,
        )
        self.other_contact = LeadContact.objects.create(
            full_name="Other Person",
            phone="555-2222",
            project_address="Other St",
            email="other@example.com",
            created_by=self.other,
        )

    def test_contacts_list_requires_authentication(self):
        response = self.client.get("/api/v1/contacts/")
        self.assertEqual(response.status_code, 401)

    def test_contacts_list_returns_user_scoped_rows(self):
        response = self.client.get(
            "/api/v1/contacts/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], self.contact.id)

    def test_contacts_list_supports_search(self):
        response = self.client.get(
            "/api/v1/contacts/?q=Alice",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], self.contact.id)

    def test_contact_patch_updates_record(self):
        response = self.client.patch(
            f"/api/v1/contacts/{self.contact.id}/",
            data={
                "phone": "",
                "email": "alice-updated@example.com",
                "notes": "Updated note",
                "status": LeadContact.Status.QUALIFIED,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.contact.refresh_from_db()
        self.assertEqual(self.contact.phone, "")
        self.assertEqual(self.contact.email, "alice-updated@example.com")
        self.assertEqual(self.contact.notes, "Updated note")
        self.assertEqual(self.contact.status, LeadContact.Status.QUALIFIED)
        record = LeadContactRecord.objects.get(lead_contact_id=self.contact.id)
        self.assertEqual(record.event_type, LeadContactRecord.EventType.STATUS_CHANGED)
        self.assertEqual(record.from_status, LeadContact.Status.NEW_CONTACT)
        self.assertEqual(record.to_status, LeadContact.Status.QUALIFIED)

    def test_contact_patch_requires_phone_or_email(self):
        response = self.client.patch(
            f"/api/v1/contacts/{self.contact.id}/",
            data={"phone": "", "email": ""},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("phone", payload)
        self.assertIn("email", payload)

    def test_contact_patch_rejects_invalid_status_transition(self):
        self.contact.status = LeadContact.Status.QUALIFIED
        self.contact.save(update_fields=["status", "updated_at"])

        response = self.client.patch(
            f"/api/v1/contacts/{self.contact.id}/",
            data={"status": LeadContact.Status.NEW_CONTACT},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("status", payload)

    def test_contact_detail_is_user_scoped(self):
        response = self.client.get(
            f"/api/v1/contacts/{self.other_contact.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 404)

    def test_contact_delete_removes_record(self):
        response = self.client.delete(
            f"/api/v1/contacts/{self.contact.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(LeadContact.objects.filter(id=self.contact.id).exists())
        record = LeadContactRecord.objects.get(event_type=LeadContactRecord.EventType.DELETED)
        self.assertEqual(record.capture_source, LeadContactRecord.CaptureSource.MANUAL_UI)
        self.assertIsNone(record.lead_contact_id)

    def test_contact_delete_is_user_scoped(self):
        response = self.client.delete(
            f"/api/v1/contacts/{self.other_contact.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(LeadContact.objects.filter(id=self.other_contact.id).exists())

    def test_lead_contact_and_customer_records_are_immutable(self):
        lead_record = LeadContactRecord.objects.create(
            lead_contact=self.contact,
            event_type=LeadContactRecord.EventType.UPDATED,
            capture_source=LeadContactRecord.CaptureSource.SYSTEM,
            from_status=self.contact.status,
            to_status=self.contact.status,
            snapshot_json={"lead_contact": {"id": self.contact.id}},
            metadata_json={},
            recorded_by=self.user,
        )
        customer = Customer.objects.create(
            display_name="Immutable Customer",
            email="immutable@example.com",
            phone="555-1212",
            billing_address="101 Audit Ln",
            created_by=self.user,
        )
        customer_record = CustomerRecord.objects.create(
            customer=customer,
            event_type=CustomerRecord.EventType.CREATED,
            capture_source=CustomerRecord.CaptureSource.SYSTEM,
            snapshot_json={"customer": {"id": customer.id}},
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
            "core.views.shared_operations.intake._record_lead_contact_record",
            side_effect=RuntimeError("capture-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.delete(
                    f"/api/v1/contacts/{self.contact.id}/",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertTrue(LeadContact.objects.filter(id=self.contact.id).exists())
