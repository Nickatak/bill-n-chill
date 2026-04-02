"""QuickBooks Online OAuth2 connection endpoints.

STATUS: Incomplete — scaffolded but not yet production-ready. Feature-gated
behind QBO_ENABLED env var. No test coverage yet.

Provides connect (redirect to Intuit), callback (exchange code for tokens),
disconnect, and status endpoints. All endpoints require authentication and
are gated behind the QBO_ENABLED environment variable.
"""

import logging

from django.shortcuts import redirect
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from core.models.shared_operations.qbo_connection import QBOConnection
from core.utils.qbo import (
    build_authorization_url,
    exchange_code_for_tokens,
    generate_oauth_state,
    is_qbo_enabled,
    revoke_token,
)
from core.views.helpers import _ensure_org_membership

logger = logging.getLogger(__name__)


def _qbo_gate(view_func):
    """Decorator that returns 404 when QBO integration is disabled."""
    def wrapper(*args, **kwargs):
        if not is_qbo_enabled():
            return Response(status=404)
        return view_func(*args, **kwargs)
    wrapper.__name__ = view_func.__name__
    wrapper.__doc__ = view_func.__doc__
    return wrapper


# ---------------------------------------------------------------------------
# Connect — redirect to Intuit OAuth consent screen
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
@_qbo_gate
def qbo_connect_view(request: Request) -> Response:
    """Initiate QBO OAuth2 flow by redirecting to Intuit's consent screen.

    Stores the OAuth state in the session for CSRF verification on callback.
    """
    membership = _ensure_org_membership(request)
    if isinstance(membership, Response):
        return membership

    state = generate_oauth_state()
    request.session["qbo_oauth_state"] = state
    request.session["qbo_oauth_org_id"] = membership.organization_id

    authorization_url = build_authorization_url(state)
    return Response({"data": {"authorization_url": authorization_url}})


# ---------------------------------------------------------------------------
# Callback — exchange authorization code for tokens
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
@_qbo_gate
def qbo_callback_view(request: Request) -> Response:
    """Handle Intuit OAuth2 callback: validate state, exchange code for tokens.

    Query parameters from Intuit:
    - code: authorization code
    - realmId: QBO company ID
    - state: CSRF state parameter
    """
    code = request.query_params.get("code", "")
    realm_id = request.query_params.get("realmId", "")
    state = request.query_params.get("state", "")

    if not code or not realm_id or not state:
        return Response(
            {"error": {"code": "missing_params", "message": "Missing code, realmId, or state parameter."}},
            status=400,
        )

    # Validate CSRF state
    expected_state = request.session.pop("qbo_oauth_state", "")
    expected_org_id = request.session.pop("qbo_oauth_org_id", None)

    if not expected_state or state != expected_state:
        return Response(
            {"error": {"code": "invalid_state", "message": "OAuth state mismatch. Please try connecting again."}},
            status=400,
        )

    membership = _ensure_org_membership(request)
    if isinstance(membership, Response):
        return membership

    if expected_org_id and membership.organization_id != expected_org_id:
        return Response(
            {"error": {"code": "org_mismatch", "message": "Organization changed during OAuth flow. Please try again."}},
            status=400,
        )

    # Exchange code for tokens
    try:
        tokens = exchange_code_for_tokens(code, realm_id)
    except Exception:
        logger.exception("QBO token exchange failed for org=%s", membership.organization_id)
        return Response(
            {"error": {"code": "token_exchange_failed", "message": "Could not complete QuickBooks connection. Please try again."}},
            status=502,
        )

    # Create or update the connection
    connection, _created = QBOConnection.objects.update_or_create(
        organization_id=membership.organization_id,
        defaults={
            "realm_id": realm_id,
            "access_token_expires_at": tokens["access_token_expires_at"],
            "refresh_token_expires_at": tokens["refresh_token_expires_at"],
            "connected_by": request.user,
            "disconnected_at": None,
        },
    )
    # Set encrypted tokens via property setters
    connection.access_token = tokens["access_token"]
    connection.refresh_token = tokens["refresh_token"]
    connection.save(update_fields=["_access_token", "_refresh_token", "updated_at"])

    logger.info(
        "QBO connected: org=%s realm=%s by=%s",
        membership.organization_id,
        realm_id,
        request.user.email,
    )

    # Redirect to frontend org settings page
    frontend_url = request.build_absolute_uri("/ops/organization?tab=integrations&qbo=connected")
    return redirect(frontend_url)


# ---------------------------------------------------------------------------
# Disconnect — revoke tokens and clear connection
# ---------------------------------------------------------------------------

@api_view(["POST"])
@permission_classes([IsAuthenticated])
@_qbo_gate
def qbo_disconnect_view(request: Request) -> Response:
    """Disconnect the current organization from QuickBooks Online.

    Revokes the refresh token with Intuit and clears stored tokens.
    """
    membership = _ensure_org_membership(request)
    if isinstance(membership, Response):
        return membership

    try:
        connection = QBOConnection.objects.get(
            organization_id=membership.organization_id,
            disconnected_at__isnull=True,
        )
    except QBOConnection.DoesNotExist:
        return Response(
            {"error": {"code": "not_connected", "message": "No active QuickBooks connection found."}},
            status=404,
        )

    # Best-effort revoke with Intuit
    refresh_token = connection.refresh_token
    if refresh_token:
        revoke_token(refresh_token)

    connection.disconnect()

    logger.info(
        "QBO disconnected: org=%s realm=%s by=%s",
        membership.organization_id,
        connection.realm_id,
        request.user.email,
    )

    return Response({"data": {"message": "QuickBooks disconnected."}})


# ---------------------------------------------------------------------------
# Status — check connection state
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
@_qbo_gate
def qbo_status_view(request: Request) -> Response:
    """Return the QBO connection status for the current organization."""
    membership = _ensure_org_membership(request)
    if isinstance(membership, Response):
        return membership

    try:
        connection = QBOConnection.objects.get(
            organization_id=membership.organization_id,
        )
    except QBOConnection.DoesNotExist:
        return Response({"data": {"connected": False}})

    if not connection.is_connected:
        return Response({"data": {"connected": False}})

    return Response({
        "data": {
            "connected": True,
            "realm_id": connection.realm_id,
            "connected_at": connection.connected_at.isoformat(),
            "access_token_expired": connection.is_access_token_expired,
            "refresh_token_expired": connection.is_refresh_token_expired,
        },
    })
