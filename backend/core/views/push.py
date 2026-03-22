"""Push subscription management endpoints.

Authenticated users can subscribe and unsubscribe their browser/device
for Web Push notifications.
"""

import hashlib

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models.shared_operations.push_subscription import PushSubscription


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def push_subscribe_view(request):
    """Register or update a push subscription for the current user.

    Upserts on endpoint hash — if the same browser re-subscribes (e.g. after
    key rotation), the existing row is updated rather than duplicated.

    Request body::

        {
            "endpoint": "https://fcm.googleapis.com/...",
            "keys": {
                "p256dh": "base64url...",
                "auth": "base64url..."
            }
        }

    Success 200::

        { "data": { "subscribed": true } }

    Errors:
        - 400: Missing required fields.
    """
    endpoint = (request.data.get("endpoint") or "").strip()
    keys = request.data.get("keys") or {}
    p256dh = (keys.get("p256dh") or "").strip()
    auth = (keys.get("auth") or "").strip()

    if not endpoint or not p256dh or not auth:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "endpoint, keys.p256dh, and keys.auth are required.",
                    "fields": {},
                }
            },
            status=400,
        )

    endpoint_hash = hashlib.sha256(endpoint.encode()).hexdigest()

    PushSubscription.objects.update_or_create(
        endpoint_hash=endpoint_hash,
        defaults={
            "user": request.user,
            "endpoint": endpoint,
            "p256dh": p256dh,
            "auth": auth,
        },
    )

    return Response({"data": {"subscribed": True}})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def push_unsubscribe_view(request):
    """Remove a push subscription for the current user.

    Request body::

        { "endpoint": "https://fcm.googleapis.com/..." }

    Success 200::

        { "data": { "unsubscribed": true } }
    """
    endpoint = (request.data.get("endpoint") or "").strip()
    if not endpoint:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "endpoint is required.",
                    "fields": {},
                }
            },
            status=400,
        )

    endpoint_hash = hashlib.sha256(endpoint.encode()).hexdigest()
    PushSubscription.objects.filter(
        user=request.user,
        endpoint_hash=endpoint_hash,
    ).delete()

    return Response({"data": {"unsubscribed": True}})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def push_status_view(request):
    """Check if the current user has any active push subscriptions.

    Success 200::

        { "data": { "has_subscriptions": true, "count": 2 } }
    """
    count = PushSubscription.objects.filter(user=request.user).count()
    return Response({"data": {"has_subscriptions": count > 0, "count": count}})
