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

    def test_contacts_list_requires_authentication(self):
        response = self.client.get("/api/v1/customers/")
        self.assertEqual(response.status_code, 401)

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

    def test_contacts_list_includes_customers_from_same_organization(self):
        shared_org = Organization.objects.create(
            display_name="Shared Contact Org",
            slug="shared-contact-org",
            created_by=self.user,
        )
        OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        OrganizationMembership.objects.update_or_create(
            user=self.other,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.PM,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )

        response = self.client.get(
            "/api/v1/customers/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        returned_ids = {row["id"] for row in rows}
        self.assertIn(self.customer.id, returned_ids)
        self.assertIn(self.other_customer.id, returned_ids)

    def test_contact_detail_allows_access_to_same_organization_customer(self):
        shared_org = Organization.objects.create(
            display_name="Shared Contact Detail Org",
            slug="shared-contact-detail-org",
            created_by=self.user,
        )
        OrganizationMembership.objects.update_or_create(
            user=self.user,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.OWNER,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        OrganizationMembership.objects.update_or_create(
            user=self.other,
            defaults={
                "organization": shared_org,
                "role": OrganizationMembership.Role.PM,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )

        response = self.client.get(
            f"/api/v1/customers/{self.other_customer.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["id"], self.other_customer.id)

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
        self.assertEqual(record.metadata_json.get("cancelled_prospect_project_count"), 0)

    def test_contact_patch_archiving_cancels_prospect_projects(self):
        prospect = Project.objects.create(
            customer=self.customer,
            name="Prospect Project",
            site_address="88 Prospect Way",
            status=Project.Status.PROSPECT,
            contract_value_original=0,
            contract_value_current=0,
            created_by=self.user,
        )
        completed = Project.objects.create(
            customer=self.customer,
            name="Completed Project",
            site_address="77 Finished Ave",
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
        prospect.refresh_from_db()
        completed.refresh_from_db()
        self.assertEqual(prospect.status, Project.Status.CANCELLED)
        self.assertEqual(completed.status, Project.Status.COMPLETED)

        record = CustomerRecord.objects.filter(customer_id=self.customer.id).latest("id")
        self.assertEqual(record.event_type, CustomerRecord.EventType.UPDATED)
        self.assertEqual(record.metadata_json.get("cancelled_prospect_project_count"), 1)

    def test_contact_patch_rejects_archive_when_customer_has_active_project(self):
        active = Project.objects.create(
            customer=self.customer,
            name="Guarded Project",
            site_address="11 Guard Ln",
            status=Project.Status.ACTIVE,
            contract_value_original=0,
            contract_value_current=0,
            created_by=self.user,
        )
        prospect = Project.objects.create(
            customer=self.customer,
            name="Prospect Should Stay Prospect",
            site_address="22 Prospect Ln",
            status=Project.Status.PROSPECT,
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
        active.refresh_from_db()
        prospect.refresh_from_db()
        self.assertEqual(active.status, Project.Status.ACTIVE)
        self.assertEqual(prospect.status, Project.Status.PROSPECT)

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

    def test_contact_delete_not_allowed(self):
        response = self.client.delete(
            f"/api/v1/customers/{self.customer.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 405)
        self.assertTrue(Customer.objects.filter(id=self.customer.id).exists())
        self.assertFalse(
            CustomerRecord.objects.filter(event_type=CustomerRecord.EventType.DELETED).exists()
        )

    def test_contact_delete_not_allowed_even_with_projects(self):
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
        self.assertEqual(response.status_code, 405)
        self.assertTrue(Customer.objects.filter(id=self.customer.id).exists())
        self.assertFalse(
            CustomerRecord.objects.filter(event_type=CustomerRecord.EventType.DELETED).exists()
        )

    def test_contact_delete_is_not_allowed_for_other_user_record(self):
        response = self.client.delete(
            f"/api/v1/customers/{self.other_customer.id}/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 405)
        self.assertTrue(Customer.objects.filter(id=self.other_customer.id).exists())

    def test_customer_intake_and_customer_records_are_immutable(self):
        lead_record = LeadContactRecord.objects.create(
            intake_record_id=77,
            event_type=LeadContactRecord.EventType.UPDATED,
            capture_source=LeadContactRecord.CaptureSource.SYSTEM,
            from_status=None,
            to_status=None,
            snapshot_json={"customer_intake": {"id": 77}},
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
