from core.tests.common import *


class OrganizationManagementTests(TestCase):
    def setUp(self):
        self.owner_user = User.objects.create_user(
            username="org-owner",
            email="org-owner@example.com",
            password="secret123",
        )
        self.pm_user = User.objects.create_user(
            username="org-pm",
            email="org-pm@example.com",
            password="secret123",
        )
        self.viewer_user = User.objects.create_user(
            username="org-viewer",
            email="org-viewer@example.com",
            password="secret123",
        )
        self.outsider_user = User.objects.create_user(
            username="org-outsider",
            email="org-outsider@example.com",
            password="secret123",
        )
        self.owner_token, _ = Token.objects.get_or_create(user=self.owner_user)
        self.pm_token, _ = Token.objects.get_or_create(user=self.pm_user)
        self.viewer_token, _ = Token.objects.get_or_create(user=self.viewer_user)
        self.outsider_token, _ = Token.objects.get_or_create(user=self.outsider_user)

        self.organization = Organization.objects.create(
            display_name="Org Management Test",
            slug="org-management-test",
            created_by=self.owner_user,
        )
        self.owner_membership = OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.owner_user,
            role=OrganizationMembership.Role.OWNER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        self.pm_membership = OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.pm_user,
            role=OrganizationMembership.Role.PM,
            status=OrganizationMembership.Status.ACTIVE,
        )
        self.viewer_membership = OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.viewer_user,
            role=OrganizationMembership.Role.VIEWER,
            status=OrganizationMembership.Status.ACTIVE,
        )

        self.other_organization = Organization.objects.create(
            display_name="Other Org",
            slug="org-management-other",
            created_by=self.outsider_user,
        )
        self.outsider_membership = OrganizationMembership.objects.create(
            organization=self.other_organization,
            user=self.outsider_user,
            role=OrganizationMembership.Role.OWNER,
            status=OrganizationMembership.Status.ACTIVE,
        )

    def test_organization_endpoints_require_authentication(self):
        profile = self.client.get("/api/v1/organization/")
        memberships = self.client.get("/api/v1/organization/memberships/")
        patch_membership = self.client.patch(
            f"/api/v1/organization/memberships/{self.pm_membership.id}/",
            data={"role": OrganizationMembership.Role.BOOKKEEPING},
            content_type="application/json",
        )

        self.assertEqual(profile.status_code, 401)
        self.assertEqual(memberships.status_code, 401)
        self.assertEqual(patch_membership.status_code, 401)

    def test_organization_profile_get_returns_profile_and_role_policy(self):
        response = self.client.get(
            "/api/v1/organization/",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 200)

        payload = response.json()["data"]
        self.assertEqual(payload["organization"]["id"], self.organization.id)
        self.assertEqual(payload["organization"]["display_name"], self.organization.display_name)
        self.assertEqual(payload["current_membership"]["id"], self.owner_membership.id)
        self.assertEqual(payload["active_member_count"], 3)
        self.assertEqual(payload["role_policy"]["effective_role"], "owner")
        self.assertTrue(payload["role_policy"]["can_edit_profile"])
        self.assertTrue(payload["role_policy"]["can_manage_memberships"])

    def test_organization_profile_patch_allows_owner_and_pm_but_forbids_viewer(self):
        patch_by_pm = self.client.patch(
            "/api/v1/organization/",
            data={"display_name": "Org Name From PM"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.pm_token.key}",
        )
        self.assertEqual(patch_by_pm.status_code, 200)
        self.organization.refresh_from_db()
        self.assertEqual(self.organization.display_name, "Org Name From PM")

        latest_record = OrganizationRecord.objects.filter(organization=self.organization).latest("id")
        self.assertEqual(latest_record.event_type, OrganizationRecord.EventType.UPDATED)
        self.assertEqual(latest_record.recorded_by_id, self.pm_user.id)

        patch_by_viewer = self.client.patch(
            "/api/v1/organization/",
            data={"display_name": "Viewer Should Not Edit"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.viewer_token.key}",
        )
        self.assertEqual(patch_by_viewer.status_code, 403)
        self.assertEqual(patch_by_viewer.json()["error"]["code"], "forbidden")

    def test_organization_profile_patch_validates_slug_uniqueness(self):
        response = self.client.patch(
            "/api/v1/organization/",
            data={"slug": self.other_organization.slug},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("slug", response.json()["error"]["fields"])

    def test_organization_profile_patch_updates_invoice_branding_defaults(self):
        response = self.client.patch(
            "/api/v1/organization/",
            data={
                "logo_url": "https://example.com/new-logo.png",
                "invoice_sender_name": "Billing Team",
                "invoice_sender_email": "billing@example.com",
                "invoice_sender_address": "123 Main St\nAustin, TX 78701",
                "invoice_default_due_days": 21,
                "invoice_default_terms": "Net 21",
                "estimate_default_terms": "Estimate terms and assumptions.",
                "change_order_default_reason": "Default CO reason text.",
                "invoice_default_footer": "Thanks for your business.",
                "invoice_default_notes": "Please include invoice number with payment.",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.organization.refresh_from_db()
        self.assertEqual(self.organization.logo_url, "https://example.com/new-logo.png")
        self.assertEqual(self.organization.invoice_sender_name, "Billing Team")
        self.assertEqual(self.organization.invoice_sender_email, "billing@example.com")
        self.assertEqual(self.organization.invoice_sender_address, "123 Main St\nAustin, TX 78701")
        self.assertEqual(self.organization.invoice_default_due_days, 21)
        self.assertEqual(self.organization.invoice_default_terms, "Net 21")
        self.assertEqual(self.organization.estimate_default_terms, "Estimate terms and assumptions.")
        self.assertEqual(self.organization.change_order_default_reason, "Default CO reason text.")
        self.assertEqual(self.organization.invoice_default_footer, "Thanks for your business.")
        self.assertEqual(
            self.organization.invoice_default_notes,
            "Please include invoice number with payment.",
        )

    def test_organization_profile_patch_validates_invoice_default_due_days_range(self):
        response = self.client.patch(
            "/api/v1/organization/",
            data={"invoice_default_due_days": 0},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("invoice_default_due_days", response.json())

    def test_organization_memberships_list_is_scoped_to_active_org(self):
        response = self.client.get(
            "/api/v1/organization/memberships/",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 200)

        rows = response.json()["data"]["memberships"]
        returned_ids = {row["id"] for row in rows}
        self.assertIn(self.owner_membership.id, returned_ids)
        self.assertIn(self.pm_membership.id, returned_ids)
        self.assertIn(self.viewer_membership.id, returned_ids)
        self.assertNotIn(self.outsider_membership.id, returned_ids)

    def test_organization_membership_patch_requires_owner_role(self):
        response = self.client.patch(
            f"/api/v1/organization/memberships/{self.viewer_membership.id}/",
            data={"role": OrganizationMembership.Role.WORKER},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.pm_token.key}",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "forbidden")

    def test_owner_can_update_membership_role_and_status_with_audit_records(self):
        response = self.client.patch(
            f"/api/v1/organization/memberships/{self.pm_membership.id}/",
            data={
                "role": OrganizationMembership.Role.BOOKKEEPING,
                "status": OrganizationMembership.Status.DISABLED,
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.pm_membership.refresh_from_db()
        self.assertEqual(self.pm_membership.role, OrganizationMembership.Role.BOOKKEEPING)
        self.assertEqual(self.pm_membership.status, OrganizationMembership.Status.DISABLED)

        records = OrganizationMembershipRecord.objects.filter(
            organization_membership=self.pm_membership,
            recorded_by=self.owner_user,
        )
        self.assertTrue(
            records.filter(event_type=OrganizationMembershipRecord.EventType.ROLE_CHANGED).exists()
        )
        self.assertTrue(
            records.filter(event_type=OrganizationMembershipRecord.EventType.STATUS_CHANGED).exists()
        )

    def test_owner_cannot_self_disable_or_self_downgrade_role(self):
        self_disable = self.client.patch(
            f"/api/v1/organization/memberships/{self.owner_membership.id}/",
            data={"status": OrganizationMembership.Status.DISABLED},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(self_disable.status_code, 400)
        self.assertEqual(self_disable.json()["error"]["code"], "validation_error")

        self_downgrade = self.client.patch(
            f"/api/v1/organization/memberships/{self.owner_membership.id}/",
            data={"role": OrganizationMembership.Role.PM},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(self_downgrade.status_code, 400)
        self.assertEqual(self_downgrade.json()["error"]["code"], "validation_error")

    def test_organization_membership_patch_returns_not_found_for_other_org(self):
        response = self.client.patch(
            f"/api/v1/organization/memberships/{self.outsider_membership.id}/",
            data={"role": OrganizationMembership.Role.PM},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "not_found")
