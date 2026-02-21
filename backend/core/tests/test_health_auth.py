from core.tests.common import *
from django.contrib.auth.models import Group

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
        self.assertOrganizationPayload(login_response.json()["data"]["organization"])
        token = login_response.json()["data"]["token"]
        self.assertTrue(token)

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["data"]["email"], "pm@example.com")
        self.assertOrganizationPayload(me_response.json()["data"]["organization"])

        membership = OrganizationMembership.objects.get(user=self.user)
        self.assertEqual(membership.role, OrganizationMembership.Role.OWNER)
        self.assertEqual(membership.status, OrganizationMembership.Status.ACTIVE)

    def test_register_creates_account_and_returns_token(self):
        register_response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "newuser@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(register_response.status_code, 201)
        self.assertOrganizationPayload(register_response.json()["data"]["organization"])
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

    def test_org_slug_generation_handles_email_local_part_collisions(self):
        user_a = User.objects.create_user(
            username="bob-a",
            email="bob@example.com",
            password="secret123",
        )
        user_b = User.objects.create_user(
            username="bob-b",
            email="bob@another-domain.com",
            password="secret123",
        )

        login_a = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "bob@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(login_a.status_code, 200)
        login_b = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "bob@another-domain.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(login_b.status_code, 200)

        membership_a = OrganizationMembership.objects.get(user=user_a)
        membership_b = OrganizationMembership.objects.get(user=user_b)
        self.assertNotEqual(membership_a.organization.slug, membership_b.organization.slug)
        self.assertTrue(membership_a.organization.slug.startswith("bob"))
        self.assertTrue(membership_b.organization.slug.startswith("bob"))

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
            slug="mixed-role-org",
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
        self.assertIn("slug", organization)
        self.assertIsNotNone(organization["id"])
        self.assertTrue(organization["display_name"])
        self.assertTrue(organization["slug"])
