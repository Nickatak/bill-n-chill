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

    def test_contact_delete_is_user_scoped(self):
        response = self.client.delete(
            f"/api/v1/contacts/{self.other_contact.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(LeadContact.objects.filter(id=self.other_contact.id).exists())
