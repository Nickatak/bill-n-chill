from core.tests.common import *

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
        self.assertIn("organization", login_response.json()["data"])
        token = login_response.json()["data"]["token"]
        self.assertTrue(token)

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["data"]["email"], "pm@example.com")
        self.assertIn("organization", me_response.json()["data"])

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
        self.assertIn("organization", register_response.json()["data"])
        token = register_response.json()["data"]["token"]
        self.assertTrue(token)

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["data"]["email"], "newuser@example.com")
        self.assertIn("organization", me_response.json()["data"])

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
