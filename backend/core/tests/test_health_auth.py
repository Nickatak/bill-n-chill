from core.tests.common import *
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from core.policies.cost_codes import STARTER_COST_CODE_ROWS

class HealthEndpointTests(TestCase):
    def test_health_endpoint_returns_ok_payload(self):
        response = self.client.get("/api/v1/health/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data"]["status"], "ok")
        self.assertIn("app_revision", payload["data"])
        self.assertIn("app_build_at", payload["data"])
        self.assertIn("data_reset_at", payload["data"])


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
        self.assertOrganizationPayload(login_response.json()["data"]["organization"])
        self.assertIn("capabilities", login_response.json()["data"])
        token = login_response.json()["data"]["token"]
        self.assertTrue(token)

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["data"]["email"], "pm@example.com")
        self.assertOrganizationPayload(me_response.json()["data"]["organization"])
        self.assertIn("capabilities", me_response.json()["data"])

        membership = OrganizationMembership.objects.get(user=self.user)
        self.assertEqual(membership.role, OrganizationMembership.Role.OWNER)
        self.assertEqual(membership.status, OrganizationMembership.Status.ACTIVE)
        self.assertEqual(
            CostCode.objects.filter(organization_id=membership.organization_id).count(),
            len(STARTER_COST_CODE_ROWS),
        )

    def test_register_creates_account_and_returns_token(self):
        register_response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "newuser@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(register_response.status_code, 201)
        self.assertOrganizationPayload(register_response.json()["data"]["organization"])
        self.assertIn("capabilities", register_response.json()["data"])
        token = register_response.json()["data"]["token"]
        self.assertTrue(token)

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["data"]["email"], "newuser@example.com")
        self.assertOrganizationPayload(me_response.json()["data"]["organization"])

        new_user = User.objects.get(email="newuser@example.com")
        membership = OrganizationMembership.objects.get(user=new_user)
        self.assertEqual(membership.role, OrganizationMembership.Role.OWNER)
        self.assertEqual(membership.status, OrganizationMembership.Status.ACTIVE)
        self.assertEqual(
            CostCode.objects.filter(organization_id=membership.organization_id).count(),
            len(STARTER_COST_CODE_ROWS),
        )

    def test_register_bootstraps_organization_defaults(self):
        register_response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "defaults@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(register_response.status_code, 201)

        user = User.objects.get(email="defaults@example.com")
        membership = OrganizationMembership.objects.select_related("organization").get(user=user)
        organization = membership.organization

        self.assertEqual(organization.help_email, "defaults@example.com")
        self.assertEqual(organization.default_invoice_due_delta, 30)
        self.assertEqual(organization.default_estimate_valid_delta, 30)
        self.assertEqual(
            organization.invoice_terms_and_conditions,
            "Payment due within 30 days of invoice date.",
        )
        self.assertEqual(
            organization.estimate_terms_and_conditions,
            "Estimate is valid for 30 days. Scope and pricing are based on visible conditions only; hidden conditions may require a change order.",
        )
        self.assertEqual(
            organization.change_order_terms_and_conditions,
            "Change order pricing is based on current labor and material rates. "
            "Approved changes are final and will be reflected in the next billing cycle.",
        )

    def test_register_rejects_duplicate_email(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "pm@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_login_self_heals_legacy_user_missing_membership(self):
        legacy_user = User.objects.create_user(
            username="legacy",
            email="legacy@example.com",
            password="secret123",
        )
        self.assertFalse(OrganizationMembership.objects.filter(user=legacy_user).exists())

        login_response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "legacy@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(OrganizationMembership.objects.filter(user=legacy_user).exists())
        self.assertOrganizationPayload(login_response.json()["data"]["organization"])

    def test_login_self_heal_writes_org_and_membership_records(self):
        legacy_user = User.objects.create_user(
            username="legacy-audit",
            email="legacy-audit@example.com",
            password="secret123",
        )
        self.assertFalse(OrganizationMembership.objects.filter(user=legacy_user).exists())

        login_response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "legacy-audit@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)
        membership = OrganizationMembership.objects.get(user=legacy_user)

        org_records = OrganizationRecord.objects.filter(organization=membership.organization)
        membership_records = OrganizationMembershipRecord.objects.filter(
            organization_membership=membership
        )

        self.assertEqual(org_records.count(), 1)
        self.assertEqual(membership_records.count(), 1)

        org_record = org_records.get()
        self.assertEqual(org_record.event_type, OrganizationRecord.EventType.CREATED)
        self.assertEqual(org_record.capture_source, OrganizationRecord.CaptureSource.AUTH_BOOTSTRAP)
        self.assertEqual(org_record.recorded_by_id, legacy_user.id)

        membership_record = membership_records.get()
        self.assertEqual(
            membership_record.event_type,
            OrganizationMembershipRecord.EventType.CREATED,
        )
        self.assertEqual(
            membership_record.capture_source,
            OrganizationMembershipRecord.CaptureSource.AUTH_BOOTSTRAP,
        )
        self.assertEqual(membership_record.recorded_by_id, legacy_user.id)
        self.assertIsNone(membership_record.from_status)
        self.assertEqual(membership_record.to_status, OrganizationMembership.Status.ACTIVE)
        self.assertEqual(membership_record.to_role, OrganizationMembership.Role.OWNER)

    def test_me_self_heals_legacy_user_missing_membership(self):
        legacy_user = User.objects.create_user(
            username="legacy-me",
            email="legacy-me@example.com",
            password="secret123",
        )
        token, _ = Token.objects.get_or_create(user=legacy_user)
        self.assertFalse(OrganizationMembership.objects.filter(user=legacy_user).exists())

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertTrue(OrganizationMembership.objects.filter(user=legacy_user).exists())
        self.assertOrganizationPayload(me_response.json()["data"]["organization"])

    def test_org_and_membership_records_are_immutable(self):
        login_response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "pm@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)
        membership = OrganizationMembership.objects.get(user=self.user)
        org_record = OrganizationRecord.objects.get(organization=membership.organization)
        membership_record = OrganizationMembershipRecord.objects.get(organization_membership=membership)

        org_record.note = "edited"
        with self.assertRaises(ValidationError):
            org_record.save()
        with self.assertRaises(ValidationError):
            org_record.delete()
        with self.assertRaises(ValidationError):
            OrganizationRecord.objects.filter(pk=org_record.pk).delete()

        membership_record.note = "edited"
        with self.assertRaises(ValidationError):
            membership_record.save()
        with self.assertRaises(ValidationError):
            membership_record.delete()
        with self.assertRaises(ValidationError):
            OrganizationMembershipRecord.objects.filter(pk=membership_record.pk).delete()

    def test_membership_role_overrides_legacy_group_role_resolution(self):
        user = User.objects.create_user(
            username="mixed-role",
            email="mixed-role@example.com",
            password="secret123",
        )
        owner_group, _ = Group.objects.get_or_create(name="owner")
        user.groups.add(owner_group)

        org = Organization.objects.create(
            display_name="Mixed Role Org",
            created_by=user,
        )
        OrganizationMembership.objects.create(
            organization=org,
            user=user,
            role=OrganizationMembership.Role.VIEWER,
            status=OrganizationMembership.Status.ACTIVE,
        )

        login_response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "mixed-role@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(login_response.json()["data"]["user"]["role"], "viewer")

    def assertOrganizationPayload(self, organization):
        self.assertIsInstance(organization, dict)
        self.assertIn("id", organization)
        self.assertIn("display_name", organization)
        self.assertIsNotNone(organization["id"])
        self.assertTrue(organization["display_name"])
