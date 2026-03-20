"""Shared helpers for authentication and registration views.

Contains:
    - Auth response payload construction.
    - Invite token lookup and error mapping.
    - Rate-limited token email delivery (verification and password reset).
    - Duplicate registration handling.
    - Token verification error mappings.
"""

from collections.abc import Callable
from datetime import timedelta
from typing import Any

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.response import Response

from core.models import (
    EmailVerificationToken,
    OrganizationInvite,
    OrganizationMembership,
    PasswordResetToken,
)
from core.user_helpers import _resolve_user_capabilities
from core.utils.email import send_password_reset_email, send_verification_email


# ---------------------------------------------------------------------------
# Token verification error mappings (imported by views)
# ---------------------------------------------------------------------------

_VERIFY_ERROR_MAP = {
    "not_found": (404, "not_found", "Invalid verification link."),
    "consumed": (410, "consumed", "This link is no longer active. If you\u2019ve already verified, sign in instead."),
    "expired": (410, "expired", "This verification link has expired. Request a new one."),
}

_RESET_ERROR_MAP = {
    "not_found": (404, "not_found", "Invalid password reset link."),
    "consumed": (410, "consumed", "This reset link has already been used."),
    "expired": (410, "expired", "This reset link has expired. Request a new one."),
}


# ---------------------------------------------------------------------------
# Auth response payload
# ---------------------------------------------------------------------------

def _build_auth_response_payload(user: AbstractUser, membership: OrganizationMembership) -> dict[str, Any]:
    """Build the standard auth response payload dict.

    Returns the canonical shape shared by login, register, verify-email,
    reset-password, accept-invite, and impersonation endpoints.  Includes
    the auth token, user identity, org context, and resolved RBAC capabilities.
    """
    return {
        "token": Token.objects.get_or_create(user=user)[0].key,
        "user": {
            "id": user.id,
            "email": user.email,
            "role": membership.role,
            "is_superuser": user.is_superuser,
        },
        "organization": {
            "id": membership.organization_id,
            "display_name": membership.organization.display_name,
            "onboarding_completed": membership.organization.onboarding_completed,
        },
        "capabilities": _resolve_user_capabilities(user, membership=membership),
    }


# ---------------------------------------------------------------------------
# Invite lookup
# ---------------------------------------------------------------------------

_INVITE_ERROR_MAP = {
    "not_found": (404, "not_found", "Invite not found."),
    "consumed": (410, "consumed", "This invite has already been used."),
    "expired": (410, "expired", "This invite has expired. Ask the org admin to send a new one."),
}


def _lookup_valid_invite(token_str: str) -> tuple[OrganizationInvite | None, Response | None]:
    """Look up a valid invite token, returning (invite, error_response).

    Domain validation (exists / consumed / expired) lives on the model via
    ``OrganizationInvite.lookup_valid()``.  This helper maps those results to
    HTTP responses for view consumption.
    """
    if not token_str:
        return None, Response(
            {"error": {"code": "validation_error", "message": "invite_token is required.", "fields": {}}},
            status=400,
        )
    invite, error_code = OrganizationInvite.lookup_valid(token_str)
    if error_code:
        status, code, message = _INVITE_ERROR_MAP[error_code]
        return None, Response(
            {"error": {"code": code, "message": message, "fields": {}}},
            status=status,
        )
    return invite, None


# ---------------------------------------------------------------------------
# Rate-limited token email delivery
# ---------------------------------------------------------------------------

def _send_rate_limited_token_email(
    user: AbstractUser,
    token_model: type[models.Model],
    send_fn: Callable,
    **send_kwargs: Any,
) -> int | None:
    """Create a token and send an email, respecting a 60-second rate limit.

    Shared pattern used by verification, password reset, and duplicate
    registration flows.  Handles the full lifecycle:

        1. Check the most recent token of ``token_model`` for this user.
        2. If created <60s ago, return the remaining wait time (rate-limited).
        3. Delete any unconsumed tokens of this type (so only the latest works).
        4. Create and save a new token.
        5. Call ``send_fn(user, token_obj, **send_kwargs)``.

    Returns:
        ``None`` on success (email sent).
        ``int`` (seconds to wait) if rate-limited.
    """
    latest_token = (
        token_model.objects.filter(user=user)
        .order_by("-created_at")
        .first()
    )
    if latest_token and (timezone.now() - latest_token.created_at) < timedelta(seconds=60):
        return 60 - int((timezone.now() - latest_token.created_at).total_seconds())

    token_model.objects.filter(user=user, consumed_at__isnull=True).delete()
    token_obj = token_model(user=user, email=user.email)
    token_obj.save()
    send_fn(user, token_obj, **send_kwargs)
    return None


# ---------------------------------------------------------------------------
# Duplicate registration handling
# ---------------------------------------------------------------------------

def _send_duplicate_registration_email(user: AbstractUser) -> None:
    """Send a contextual email when someone tries to register with an existing email.

    Verified users get a password reset link with a security heads-up.
    Unverified users get a fresh verification email (respecting rate limits).
    Best-effort: failures are silently swallowed to preserve anti-enumeration.
    """
    try:
        if user.is_active:
            _send_rate_limited_token_email(
                user, PasswordResetToken, send_password_reset_email,
                is_security_alert=True,
            )
        else:
            _send_rate_limited_token_email(
                user, EmailVerificationToken, send_verification_email,
            )
    except Exception:
        pass  # Best-effort — never leak information via error responses.


