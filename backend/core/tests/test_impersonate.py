from core.tests.common import *
from core.models.shared_operations.impersonation import ImpersonationToken


class ImpersonateStartTests(TestCase):
    def setUp(self):
        self.superuser = User.objects.create_superuser(
            username="admin", email="admin@test.com", password="secret123"
        )
        self.regular_user = User.objects.create_user(
            username="pm", email="pm@test.com", password="secret123"
        )
        _bootstrap_org(self.regular_user)
        self.super_token, _ = Token.objects.get_or_create(user=self.superuser)
        self.regular_token, _ = Token.objects.get_or_create(user=self.regular_user)

    def test_auth_required(self):
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": self.regular_user.id}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_non_superuser_rejected(self):
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": self.regular_user.id}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.regular_token.key}",
        )
        self.assertEqual(response.status_code, 403)

    def test_missing_user_id(self):
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_target_not_found(self):
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": 99999}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        self.assertEqual(response.status_code, 404)

    def test_target_is_superuser_rejected(self):
        other_superuser = User.objects.create_superuser(
            username="admin2", email="admin2@test.com", password="secret123"
        )
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": other_superuser.id}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        self.assertEqual(response.status_code, 403)

    def test_happy_path(self):
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": self.regular_user.id}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("token", data)
        self.assertIn("user", data)
        self.assertIn("organization", data)
        self.assertIn("impersonation", data)
        self.assertTrue(data["impersonation"]["active"])
        self.assertEqual(data["impersonation"]["real_email"], self.superuser.email)
        # Token exists in DB
        self.assertTrue(
            ImpersonationToken.objects.filter(key=data["token"]).exists()
        )

    def test_cleans_up_prior_tokens(self):
        # Start first impersonation
        self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": self.regular_user.id}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        self.assertEqual(
            ImpersonationToken.objects.filter(impersonated_by=self.superuser).count(), 1
        )

        # Start second impersonation — prior token should be cleaned up
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": self.regular_user.id}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            ImpersonationToken.objects.filter(impersonated_by=self.superuser).count(), 1
        )


class ImpersonateExitTests(TestCase):
    def setUp(self):
        self.superuser = User.objects.create_superuser(
            username="admin", email="admin@test.com", password="secret123"
        )
        self.regular_user = User.objects.create_user(
            username="pm", email="pm@test.com", password="secret123"
        )
        _bootstrap_org(self.regular_user)
        self.super_token, _ = Token.objects.get_or_create(user=self.superuser)
        self.regular_token, _ = Token.objects.get_or_create(user=self.regular_user)

    def _start_impersonation(self):
        response = self.client.post(
            "/api/v1/admin/impersonate/",
            data=({"user_id": self.regular_user.id}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        return response.json()["data"]["token"]

    def test_happy_path(self):
        imp_token_key = self._start_impersonation()
        self.assertTrue(
            ImpersonationToken.objects.filter(key=imp_token_key).exists()
        )

        response = self.client.post(
            "/api/v1/admin/impersonate/exit/",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {imp_token_key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["data"]["message"], "Impersonation session ended."
        )
        # Token deleted from DB
        self.assertFalse(
            ImpersonationToken.objects.filter(key=imp_token_key).exists()
        )

    def test_not_impersonating_with_regular_token(self):
        response = self.client.post(
            "/api/v1/admin/impersonate/exit/",
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.regular_token.key}",
        )
        self.assertEqual(response.status_code, 400)


class ImpersonateUsersListTests(TestCase):
    def setUp(self):
        self.superuser = User.objects.create_superuser(
            username="admin", email="admin@test.com", password="secret123"
        )
        self.regular_user = User.objects.create_user(
            username="pm", email="pm@test.com", password="secret123"
        )
        _bootstrap_org(self.regular_user)
        self.super_token, _ = Token.objects.get_or_create(user=self.superuser)
        self.regular_token, _ = Token.objects.get_or_create(user=self.regular_user)

    def test_non_superuser_rejected(self):
        response = self.client.get(
            "/api/v1/admin/impersonate/users/",
            HTTP_AUTHORIZATION=f"Token {self.regular_token.key}",
        )
        self.assertEqual(response.status_code, 403)

    def test_happy_path(self):
        response = self.client.get(
            "/api/v1/admin/impersonate/users/",
            HTTP_AUTHORIZATION=f"Token {self.super_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        users = response.json()["data"]
        user_emails = [u["email"] for u in users]
        # Regular user should be in the list
        self.assertIn(self.regular_user.email, user_emails)
        # Superuser should NOT be in the list
        self.assertNotIn(self.superuser.email, user_emails)
