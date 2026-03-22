"""Web Push notification delivery utility.

Sends push notifications to all active subscriptions for a given user.
Uses pywebpush with VAPID authentication. Automatically cleans up stale
subscriptions (410 Gone / 404 Not Found from the push service).
"""

import json
import logging
import os

from pywebpush import webpush, WebPushException

from core.models.shared_operations.push_subscription import PushSubscription

logger = logging.getLogger(__name__)


def _get_vapid_claims() -> dict:
    """Build VAPID claims dict from environment variables."""
    return {
        "sub": os.getenv("VAPID_CLAIM_EMAIL", "mailto:support@bill-n-chill.com"),
    }


def _get_vapid_private_key() -> str | None:
    """Read the VAPID private key from environment.

    Expects a base64url-encoded 32-byte raw EC private key (the format
    that pywebpush/py_vapid ``Vapid.from_raw()`` consumes). Generate with::

        python -c "from py_vapid import Vapid; v = Vapid(); v.generate_keys(); ..."

    Returns None if not configured.
    """
    raw = os.getenv("VAPID_PRIVATE_KEY", "").strip()
    return raw or None


def send_push_to_user(user_id: int, payload: dict) -> int:
    """Send a push notification to all subscriptions for the given user.

    Args:
        user_id: The user to notify.
        payload: Dict with at least ``title`` and ``body``. Optional ``url``
            for notification click routing.

    Returns:
        Number of subscriptions that received the push successfully.
    """
    private_key = _get_vapid_private_key()
    if not private_key:
        logger.warning("VAPID_PRIVATE_KEY not configured — skipping push notification.")
        return 0

    subscriptions = list(
        PushSubscription.objects.filter(user_id=user_id)
    )
    if not subscriptions:
        return 0

    vapid_claims = _get_vapid_claims()
    data = json.dumps(payload)
    sent = 0
    stale_ids = []

    for sub in subscriptions:
        try:
            webpush(
                subscription_info=sub.to_webpush_dict(),
                data=data,
                vapid_private_key=private_key,
                vapid_claims=vapid_claims,
            )
            sent += 1
        except WebPushException as e:
            status_code = getattr(e, "response", None)
            if status_code is not None:
                status_code = getattr(status_code, "status_code", None)
            # 410 Gone or 404 means the subscription is no longer valid
            if status_code in (404, 410):
                stale_ids.append(sub.id)
                logger.info("Removing stale push subscription %s for user %s", sub.id, user_id)
            else:
                logger.error("Push failed for subscription %s: %s", sub.id, e)

    if stale_ids:
        PushSubscription.objects.filter(id__in=stale_ids).delete()

    return sent


def build_document_decision_payload(
    document_type: str,
    document_title: str,
    customer_name: str,
    decision: str,
    url: str,
) -> dict:
    """Build a standardized push payload for a document decision event.

    Args:
        document_type: "estimate", "change_order", or "invoice".
        document_title: Human-readable document identifier.
        customer_name: The customer who made the decision.
        decision: "approve", "reject", or "dispute".
        url: The app route to open on notification click.

    Returns:
        Dict ready to pass to ``send_push_to_user``.
    """
    type_label = document_type.replace("_", " ").title()
    action_label = decision.capitalize()
    if decision == "approve":
        action_label = "Approved"
    elif decision == "reject":
        action_label = "Rejected"
    elif decision == "dispute":
        action_label = "Disputed"

    return {
        "title": f"{type_label} {action_label}",
        "body": f"{customer_name} {action_label.lower()} {document_title}.",
        "url": url,
    }
