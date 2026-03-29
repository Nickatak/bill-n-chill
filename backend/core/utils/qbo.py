"""QuickBooks Online OAuth2 and API utilities.

Handles OAuth2 authorization URL generation, token exchange, token refresh,
and the feature-gate check. All QBO API communication goes through this module.
"""

import os
import secrets
from datetime import timedelta
from typing import TypedDict

import requests
from django.utils import timezone


# ---------------------------------------------------------------------------
# Feature gate
# ---------------------------------------------------------------------------

def is_qbo_enabled() -> bool:
    """True if QBO integration is activated via environment variable."""
    return os.getenv("QBO_ENABLED", "false").lower() == "true"


# ---------------------------------------------------------------------------
# OAuth2 configuration
# ---------------------------------------------------------------------------

_QBO_AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2"
_QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
_QBO_REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
_QBO_SCOPES = "com.intuit.quickbooks.accounting"


def _client_id() -> str:
    return os.getenv("QBO_CLIENT_ID", "")


def _client_secret() -> str:
    return os.getenv("QBO_CLIENT_SECRET", "")


def _redirect_uri() -> str:
    return os.getenv("QBO_REDIRECT_URI", "http://localhost:8000/api/v1/qbo/callback/")


# ---------------------------------------------------------------------------
# Authorization URL
# ---------------------------------------------------------------------------

def build_authorization_url(state: str) -> str:
    """Build the Intuit OAuth2 authorization URL for user consent."""
    params = {
        "client_id": _client_id(),
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": _QBO_SCOPES,
        "state": state,
    }
    query = "&".join(f"{k}={requests.utils.quote(v)}" for k, v in params.items())
    return f"{_QBO_AUTH_BASE}?{query}"


def generate_oauth_state() -> str:
    """Generate a cryptographically random state parameter for CSRF protection."""
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------------------
# Token exchange and refresh
# ---------------------------------------------------------------------------

class TokenResponse(TypedDict):
    access_token: str
    refresh_token: str
    access_token_expires_at: object  # datetime
    refresh_token_expires_at: object  # datetime
    realm_id: str


def exchange_code_for_tokens(authorization_code: str, realm_id: str) -> TokenResponse:
    """Exchange an authorization code for access and refresh tokens.

    Raises ``requests.HTTPError`` on failure.
    """
    response = requests.post(
        _QBO_TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": authorization_code,
            "redirect_uri": _redirect_uri(),
        },
        auth=(_client_id(), _client_secret()),
        headers={"Accept": "application/json"},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()

    now = timezone.now()
    return TokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        access_token_expires_at=now + timedelta(seconds=data.get("expires_in", 3600)),
        refresh_token_expires_at=now + timedelta(days=100),
        realm_id=realm_id,
    )


def refresh_access_token(current_refresh_token: str) -> TokenResponse:
    """Refresh an expired access token using the refresh token.

    Intuit returns a new refresh token with each refresh — callers must
    persist both the new access token and the new refresh token.

    Raises ``requests.HTTPError`` on failure.
    """
    response = requests.post(
        _QBO_TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "refresh_token": current_refresh_token,
        },
        auth=(_client_id(), _client_secret()),
        headers={"Accept": "application/json"},
        timeout=15,
    )
    response.raise_for_status()
    data = response.json()

    now = timezone.now()
    return TokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        access_token_expires_at=now + timedelta(seconds=data.get("expires_in", 3600)),
        refresh_token_expires_at=now + timedelta(days=100),
        realm_id="",  # Not returned on refresh — caller retains existing realm_id
    )


# ---------------------------------------------------------------------------
# Connection-level helpers
# ---------------------------------------------------------------------------

def ensure_valid_access_token(connection) -> str | None:
    """Return a valid access token for the given QBOConnection, refreshing if needed.

    If the access token is expired but the refresh token is still valid,
    performs a refresh and persists the new tokens. Returns the access token
    on success, or None if the connection cannot be restored (refresh token
    expired, revoked, or network failure).
    """
    if connection.disconnected_at is not None:
        return None

    if connection.is_refresh_token_expired:
        return None

    if not connection.is_access_token_expired:
        return connection.access_token

    # Access token expired — attempt refresh
    current_refresh = connection.refresh_token
    if not current_refresh:
        return None

    try:
        tokens = refresh_access_token(current_refresh)
    except Exception:
        return None

    connection.access_token = tokens["access_token"]
    connection.refresh_token = tokens["refresh_token"]
    connection.access_token_expires_at = tokens["access_token_expires_at"]
    connection.refresh_token_expires_at = tokens["refresh_token_expires_at"]
    connection.save(update_fields=[
        "_access_token",
        "_refresh_token",
        "access_token_expires_at",
        "refresh_token_expires_at",
        "updated_at",
    ])

    return connection.access_token


def revoke_token(token: str) -> bool:
    """Revoke an access or refresh token. Returns True on success."""
    try:
        response = requests.post(
            _QBO_REVOKE_URL,
            json={"token": token},
            auth=(_client_id(), _client_secret()),
            headers={"Accept": "application/json"},
            timeout=15,
        )
        return response.status_code == 200
    except requests.RequestException:
        return False
