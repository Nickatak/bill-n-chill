"""PushSubscription model — stores Web Push API subscriptions per user/device."""

import hashlib

from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class PushSubscription(models.Model):
    """A Web Push subscription for delivering background notifications.

    Each row represents one browser/device subscription for one user.
    A user can have multiple subscriptions (e.g. phone + laptop).
    The endpoint URL is unique — re-subscribing from the same browser
    replaces the existing row (upsert on endpoint_hash).

    Fields mirror the PushSubscription JS object:
    - endpoint: the push service URL (stored as TextField, too long for MySQL unique index)
    - endpoint_hash: SHA-256 of endpoint for unique constraint
    - p256dh: client public key (base64url)
    - auth: shared auth secret (base64url)
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.TextField()
    endpoint_hash = models.CharField(max_length=64, unique=True, editable=False)
    p256dh = models.CharField(max_length=256)
    auth = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        """Auto-compute endpoint_hash before saving."""
        self.endpoint_hash = hashlib.sha256(self.endpoint.encode()).hexdigest()
        super().save(*args, **kwargs)

    def to_webpush_dict(self) -> dict:
        """Return the subscription info dict expected by pywebpush."""
        return {
            "endpoint": self.endpoint,
            "keys": {
                "p256dh": self.p256dh,
                "auth": self.auth,
            },
        }

    def __str__(self) -> str:
        return f"PushSubscription({self.user_id}, {self.endpoint[:60]}...)"
