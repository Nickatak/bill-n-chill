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
        token = login_response.json()["data"]["token"]
        self.assertTrue(token)

        me_response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token}",
        )
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["data"]["email"], "pm@example.com")


