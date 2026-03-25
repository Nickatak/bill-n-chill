import json

from core.tests.common import *
from core.models.shared_operations.push_subscription import PushSubscription


SUBSCRIBE_URL = "/api/v1/push/subscribe/"
UNSUBSCRIBE_URL = "/api/v1/push/unsubscribe/"
STATUS_URL = "/api/v1/push/status/"

VALID_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"
VALID_KEYS = {"p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfWLk", "auth": "tBHItJI5svbpC7LS2A_xOg"}

SECOND_ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/xyz789"
SECOND_KEYS = {"p256dh": "AAAA_test_p256dh_key_for_second_device", "auth": "BBBB_test_auth"}


def _subscribe_payload(endpoint=VALID_ENDPOINT, keys=None):
    return {"endpoint": endpoint, "keys": keys or VALID_KEYS}


class PushSubscribeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pushuser",
            email="push@example.com",
            password="secret123",
        )
        self.org = _bootstrap_org(self.user)
        self.token, _ = Token.objects.get_or_create(user=self.user)

    def test_subscribe_rejects_unauthenticated(self):
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_subscribe_happy_path(self):
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"]["subscribed"])
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 1)

        sub = PushSubscription.objects.get(user=self.user)
        self.assertEqual(sub.endpoint, VALID_ENDPOINT)
        self.assertEqual(sub.p256dh, VALID_KEYS["p256dh"])
        self.assertEqual(sub.auth, VALID_KEYS["auth"])

    def test_subscribe_missing_endpoint(self):
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps({"keys": VALID_KEYS}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_subscribe_missing_keys(self):
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps({"endpoint": VALID_ENDPOINT}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_subscribe_missing_p256dh(self):
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps({"endpoint": VALID_ENDPOINT, "keys": {"auth": "abc"}}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_subscribe_missing_auth_key(self):
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps({"endpoint": VALID_ENDPOINT, "keys": {"p256dh": "abc"}}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_subscribe_empty_body(self):
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps({}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)

    def test_subscribe_upsert_same_endpoint_updates(self):
        """Re-subscribing with the same endpoint updates keys, not duplicates."""
        self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 1)

        updated_keys = {"p256dh": "UPDATED_p256dh_key", "auth": "UPDATED_auth_secret"}
        response = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload(keys=updated_keys)),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 1)

        sub = PushSubscription.objects.get(user=self.user)
        self.assertEqual(sub.p256dh, "UPDATED_p256dh_key")
        self.assertEqual(sub.auth, "UPDATED_auth_secret")

    def test_subscribe_different_endpoints_create_separate_rows(self):
        self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload(endpoint=SECOND_ENDPOINT, keys=SECOND_KEYS)),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 2)


class PushUnsubscribeTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pushuser",
            email="push@example.com",
            password="secret123",
        )
        self.org = _bootstrap_org(self.user)
        self.token, _ = Token.objects.get_or_create(user=self.user)

        # Pre-subscribe
        self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

    def test_unsubscribe_rejects_unauthenticated(self):
        response = self.client.post(
            UNSUBSCRIBE_URL,
            data=json.dumps({"endpoint": VALID_ENDPOINT}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_unsubscribe_happy_path(self):
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 1)

        response = self.client.post(
            UNSUBSCRIBE_URL,
            data=json.dumps({"endpoint": VALID_ENDPOINT}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"]["unsubscribed"])
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 0)

    def test_unsubscribe_missing_endpoint(self):
        response = self.client.post(
            UNSUBSCRIBE_URL,
            data=json.dumps({}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_unsubscribe_nonexistent_endpoint_succeeds(self):
        """Unsubscribing from an endpoint that doesn't exist still returns 200."""
        response = self.client.post(
            UNSUBSCRIBE_URL,
            data=json.dumps({"endpoint": "https://example.com/nonexistent"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"]["unsubscribed"])
        # Original subscription still intact
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 1)

    def test_unsubscribe_only_removes_own_subscriptions(self):
        """User B cannot unsubscribe User A's endpoint."""
        other_user = User.objects.create_user(
            username="otheruser",
            email="other@example.com",
            password="secret123",
        )
        _bootstrap_org(other_user)
        other_token, _ = Token.objects.get_or_create(user=other_user)

        # Other user tries to unsubscribe our endpoint
        response = self.client.post(
            UNSUBSCRIBE_URL,
            data=json.dumps({"endpoint": VALID_ENDPOINT}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {other_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        # Original user's subscription is NOT deleted
        self.assertEqual(PushSubscription.objects.filter(user=self.user).count(), 1)


class PushStatusTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pushuser",
            email="push@example.com",
            password="secret123",
        )
        self.org = _bootstrap_org(self.user)
        self.token, _ = Token.objects.get_or_create(user=self.user)

    def test_status_rejects_unauthenticated(self):
        response = self.client.get(STATUS_URL)
        self.assertEqual(response.status_code, 401)

    def test_status_no_subscriptions(self):
        response = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertFalse(data["has_subscriptions"])
        self.assertEqual(data["count"], 0)

    def test_status_with_subscriptions(self):
        self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload(endpoint=SECOND_ENDPOINT, keys=SECOND_KEYS)),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        response = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertTrue(data["has_subscriptions"])
        self.assertEqual(data["count"], 2)

    def test_status_only_counts_own_subscriptions(self):
        """Other users' subscriptions are not included in my count."""
        other_user = User.objects.create_user(
            username="otheruser",
            email="other@example.com",
            password="secret123",
        )
        _bootstrap_org(other_user)
        other_token, _ = Token.objects.get_or_create(user=other_user)

        # Other user subscribes
        self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {other_token.key}",
        )

        # Our status should still be 0
        response = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertFalse(data["has_subscriptions"])
        self.assertEqual(data["count"], 0)


class PushLifecycleTests(TestCase):
    """Full lifecycle: subscribe -> status -> unsubscribe -> status."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="pushuser",
            email="push@example.com",
            password="secret123",
        )
        self.org = _bootstrap_org(self.user)
        self.token, _ = Token.objects.get_or_create(user=self.user)

    def test_full_lifecycle(self):
        # Start with no subscriptions
        status = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["data"]["count"], 0)
        self.assertFalse(status.json()["data"]["has_subscriptions"])

        # Subscribe first device
        resp = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload()),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resp.status_code, 200)

        # Status shows 1
        status = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(status.json()["data"]["count"], 1)
        self.assertTrue(status.json()["data"]["has_subscriptions"])

        # Subscribe second device
        resp = self.client.post(
            SUBSCRIBE_URL,
            data=json.dumps(_subscribe_payload(endpoint=SECOND_ENDPOINT, keys=SECOND_KEYS)),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resp.status_code, 200)

        # Status shows 2
        status = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(status.json()["data"]["count"], 2)

        # Unsubscribe first device
        resp = self.client.post(
            UNSUBSCRIBE_URL,
            data=json.dumps({"endpoint": VALID_ENDPOINT}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resp.status_code, 200)

        # Status shows 1
        status = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(status.json()["data"]["count"], 1)

        # Unsubscribe second device
        resp = self.client.post(
            UNSUBSCRIBE_URL,
            data=json.dumps({"endpoint": SECOND_ENDPOINT}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resp.status_code, 200)

        # Status back to 0
        status = self.client.get(
            STATUS_URL,
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(status.json()["data"]["count"], 0)
        self.assertFalse(status.json()["data"]["has_subscriptions"])
