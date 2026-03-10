"""Authentication and registration views with invite-flow support."""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import EmailVerificationToken, ImpersonationToken, OrganizationInvite, OrganizationMembership, OrganizationMembershipRecord, PasswordResetToken
from core.serializers import LoginSerializer, RegisterSerializer
from core.utils.email import send_password_reset_email, send_verification_email
from core.user_helpers import _ensure_membership, _resolve_user_capabilities

User = get_user_model()


# ── helpers ──


def _build_auth_response_payload(user, membership):
    """Build the standard auth response payload dict."""
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


_INVITE_ERROR_MAP = {
    "not_found": (404, "not_found", "Invite not found."),
    "consumed": (410, "consumed", "This invite has already been used."),
    "expired": (410, "expired", "This invite has expired. Ask the org admin to send a new one."),
}


def _lookup_valid_invite(token_str):
    """Look up a valid invite token, returning (invite, error_response).

    Domain validation (exists / consumed / expired) lives on the model via
    OrganizationInvite.lookup_valid(). This helper maps those results to
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


def _send_duplicate_registration_email(user):
    """Send a contextual email when someone tries to register with an existing email.

    Verified users get a password reset link with a security heads-up.
    Unverified users get a fresh verification email (respecting rate limits).
    Best-effort: failures are silently swallowed to preserve anti-enumeration.
    """
    from datetime import timedelta

    try:
        if user.is_active:
            # Verified user — send password reset with security alert.
            # Rate limit: most recent reset token must be >60s old.
            latest = PasswordResetToken.objects.filter(user=user).order_by("-created_at").first()
            if latest and (timezone.now() - latest.created_at) < timedelta(seconds=60):
                return
            PasswordResetToken.objects.filter(user=user, consumed_at__isnull=True).delete()
            token_obj = PasswordResetToken(user=user, email=user.email)
            token_obj.save()
            send_password_reset_email(user, token_obj, is_security_alert=True)
        else:
            # Unverified user — re-send verification email.
            # Rate limit: most recent verification token must be >60s old.
            latest = EmailVerificationToken.objects.filter(user=user).order_by("-created_at").first()
            if latest and (timezone.now() - latest.created_at) < timedelta(seconds=60):
                return
            EmailVerificationToken.objects.filter(user=user, consumed_at__isnull=True).delete()
            token_obj = EmailVerificationToken(user=user, email=user.email)
            token_obj.save()
            send_verification_email(user, token_obj)
    except Exception:
        pass  # Best-effort — never leak information via error responses.


# ── views ──


@api_view(["GET"])
@permission_classes([AllowAny])
def health_view(_request):
    """Health probe endpoint used by infra and local readiness checks.

    Contract:
    - `GET`:
      - `200`: service liveness payload returned.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `GET`: none.

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.

    - Test anchors:
      - `backend/core/tests/test_health_auth.py::test_health_endpoint_returns_ok_payload`
    """
    return Response({"data": {"status": "ok"}})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    """Login endpoint: authenticate credentials and return token + role/org context.

    Contract:
    - `POST`:
      - `200`: authenticated auth payload returned.
        - Guarantees:
          - response includes token, user identity, effective role, and organization context. `[APP]`
          - existing token is reused or a new token is created for the authenticated user. `[APP]`
      - `400`: credentials payload invalid.
        - Guarantees: no durable mutations from failed credential validation. `[APP]`

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `POST`:
        - Creates:
          - Standard: token when missing; organization/membership records when self-healing legacy users.
          - Audit: none.
        - Edits:
          - Standard: none.
          - Audit: none.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - JSON map:
        {
          "email": "string (required)",
          "password": "string (required)"
        }

    - Idempotency and retry semantics:
      - `POST` is conditionally idempotent for existing users with existing token (same token reused).
      - `POST` is retry-safe for valid credentials (retries return authenticated context).

    - Test anchors:
      - `backend/core/tests/test_health_auth.py::test_login_returns_token_and_me_works_with_token`
      - `backend/core/tests/test_health_auth.py::test_login_self_heals_legacy_user_missing_membership`
    """
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data["user"]

    # Email verification gate — unverified users (is_active=False) cannot log in.
    if not user.is_active:
        return Response(
            {"error": {"code": "email_not_verified", "message": "Please verify your email before signing in."}},
            status=403,
        )

    membership = _ensure_membership(user)

    return Response({"data": _build_auth_response_payload(user, membership)})


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    """Registration endpoint with email verification.

    Supports two flows:
    - Flow A (no invite_token): Creates user + org + sends verification email.
      Returns a uniform "check your email" response regardless of whether the
      email already exists (prevents enumeration). No auth token returned.
    - Flow B (with invite_token): Invited registration — creates user, joins
      invited org with invited role, consumes invite token. Returns auth token
      immediately (invite proves email ownership, no verification needed).

    Contract:
    - `POST`:
      - `200` (Flow A): "check your email" message returned. Same response for
        new and existing emails (anti-enumeration).
      - `201` (Flow B): user created and authenticated context returned.
      - `400`: registration payload invalid or invite email mismatch.
      - `404`: invite token not found.
      - `410`: invite token expired or already consumed.

    - Preconditions:
      - none (`AllowAny`).

    - Incoming payload (`POST`) shape:
      - JSON map:
        {
          "email": "string (required)",
          "password": "string (required)",
          "invite_token": "string (optional)"
        }

    - Test anchors:
      - `backend/core/tests/test_email_verification.py::RegisterFlowAVerificationTests`
      - `backend/core/tests/test_invites.py::test_register_with_invite_token_flow_b`
    """
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    email = serializer.validated_data["email"]
    password = serializer.validated_data["password"]
    invite_token = (request.data.get("invite_token") or "").strip()

    # Flow B: invited registration
    if invite_token:
        invite, error_response = _lookup_valid_invite(invite_token)
        if error_response:
            return error_response

        # Email must match the invite
        if invite.email.lower() != email.lower():
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Invite email does not match registration email.",
                        "fields": {"email": ["Email must match the invite."]},
                    }
                },
                status=400,
            )

        with transaction.atomic():
            user = User.objects.create_user(username=email, email=email, password=password)
            membership = OrganizationMembership.objects.create(
                organization=invite.organization,
                user=user,
                role=invite.role,
                role_template=invite.role_template,
                status=OrganizationMembership.Status.ACTIVE,
            )
            OrganizationMembershipRecord.record(
                membership=membership,
                event_type=OrganizationMembershipRecord.EventType.CREATED,
                capture_source=OrganizationMembershipRecord.CaptureSource.MANUAL_UI,
                recorded_by=user,
                from_status=None,
                to_status=membership.status,
                from_role="",
                to_role=membership.role,
                note="Membership created via invite acceptance (Flow B: new user).",
                metadata={"invite_id": invite.id},
            )
            invite.consumed_at = timezone.now()
            invite.save(update_fields=["consumed_at"])

        # Reload with select_related for response
        membership = OrganizationMembership.objects.select_related("organization").get(id=membership.id)
        return Response({"data": _build_auth_response_payload(user, membership)}, status=201)

    # Flow A: standard registration (no invite).
    # Always return the same response to prevent email enumeration.
    _CHECK_EMAIL = {"data": {"message": "Check your email to verify your account."}}

    existing_user = User.objects.filter(email__iexact=email).first()
    if existing_user:
        # Anti-enumeration: same 200 response, but send a helpful email.
        _send_duplicate_registration_email(existing_user)
        return Response(_CHECK_EMAIL, status=200)

    try:
        with transaction.atomic():
            user = User.objects.create_user(username=email, email=email, password=password, is_active=False)
            _ensure_membership(user)
            token_obj = EmailVerificationToken(user=user, email=email)
            token_obj.save()
    except IntegrityError:
        # Concurrent registration with same email — still anti-enumeration.
        return Response(_CHECK_EMAIL, status=200)

    send_verification_email(user, token_obj)  # Outside atomic — mail failure doesn't roll back user.
    return Response(_CHECK_EMAIL, status=200)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me_view(request):
    """Current-session profile endpoint with resolved role and organization scope.

    Contract:
    - `GET`:
      - `200`: authenticated user profile returned.
        - Guarantees: profile payload includes resolved role and organization context. `[APP]`
      - `401`: authentication missing/invalid.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller must be authenticated (`IsAuthenticated`).

    - Object mutations:
      - `GET`:
        - Creates:
          - Standard: organization/membership records when self-healing legacy users.
          - Audit: none.
        - Edits:
          - Standard: none.
          - Audit: none.
        - Deletes: none.

    - Idempotency and retry semantics:
      - `GET` is idempotent for established users.
      - first access by legacy users may self-heal missing organization/membership records.

    - Test anchors:
      - `backend/core/tests/test_health_auth.py::test_me_endpoint_rejects_unauthenticated_request`
      - `backend/core/tests/test_health_auth.py::test_login_returns_token_and_me_works_with_token`
      - `backend/core/tests/test_health_auth.py::test_me_self_heals_legacy_user_missing_membership`
    """
    user = request.user
    membership = _ensure_membership(user)
    payload = _build_auth_response_payload(user, membership)

    # When accessed via an impersonation token, include metadata so the
    # frontend knows to show the impersonation banner.
    if isinstance(request.auth, ImpersonationToken):
        payload["impersonation"] = {
            "active": True,
            "real_email": request.auth.impersonated_by.email,
        }

    return Response({"data": payload})


@api_view(["GET"])
@permission_classes([AllowAny])
def check_invite_by_email_view(request):
    """Check if a pending invite exists for the given email.

    Used by the register page to auto-detect pending invites when a user
    navigates to /register directly (without an invite link). Returns the
    invite token so the frontend can switch to Flow B.

    Contract:
    - `GET`:
      - `200`: pending invite found — returns org name, role, and invite token.
      - `400`: email query param missing.
      - `404`: no pending invite for this email.

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `GET`: none (read-only).

    - Security:
      - Leaks org name to anyone who guesses an invited email. Accepted
        tradeoff: requires exact email + 24h expiry window. See
        docs/meta/invite-registration-race.md.

    - Test anchors:
      - `backend/core/tests/test_invites.py::test_check_invite_by_email_*`
    """
    email = (request.query_params.get("email") or "").strip()
    if not email:
        return Response(
            {"error": {"code": "validation_error", "message": "email query parameter is required.", "fields": {}}},
            status=400,
        )

    invite = (
        OrganizationInvite.objects.select_related("organization")
        .filter(
            email__iexact=email,
            consumed_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .first()
    )

    if not invite:
        return Response(
            {"error": {"code": "not_found", "message": "No pending invite found.", "fields": {}}},
            status=404,
        )

    return Response(
        {
            "data": {
                "organization_name": invite.organization.display_name,
                "role": invite.role,
                "invite_token": invite.token,
            }
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def verify_invite_view(request, token):
    """Verify an invite token and return context for the registration page.

    Contract:
    - `GET`:
      - `200`: invite is valid — returns org name, email, role, and whether the
        email belongs to an existing user (determines Flow B vs Flow C on frontend).
      - `404`: token not found.
      - `410`: token expired or already consumed.

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `GET`: none (read-only verification).

    - Test anchors:
      - `backend/core/tests/test_invites.py::test_verify_invite_*`
    """
    invite, error_response = _lookup_valid_invite(token)
    if error_response:
        return error_response

    is_existing_user = User.objects.filter(email__iexact=invite.email).exists()

    return Response(
        {
            "data": {
                "organization_name": invite.organization.display_name,
                "email": invite.email,
                "role": invite.role,
                "is_existing_user": is_existing_user,
            }
        }
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def accept_invite_view(request):
    """Accept invite as existing user (Flow C). Requires password confirmation.

    Moves the existing user's membership from their current org to the invited org.
    This is a destructive operation (loses access to current org) and requires the
    user's password as confirmation.

    Contract:
    - `POST`:
      - `200`: membership moved, auth context returned.
        - Guarantees:
          - user's membership now points to the invited org. `[APP]`
          - invite token is consumed. `[APP]`
          - audit record created for the membership change. `[APP]`
      - `400`: missing fields.
      - `401`: invalid password.
      - `404`: invite not found or no user for invite email.
      - `410`: invite expired or consumed.

    - Preconditions:
      - none (`AllowAny`).

    - Incoming payload (`POST`) shape:
      - JSON map:
        {
          "invite_token": "string (required)",
          "password": "string (required)"
        }

    - Test anchors:
      - `backend/core/tests/test_invites.py::test_accept_invite_*`
    """
    invite_token = (request.data.get("invite_token") or "").strip()
    password = (request.data.get("password") or "").strip()

    if not invite_token or not password:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "invite_token and password are required.",
                    "fields": {},
                }
            },
            status=400,
        )

    invite, error_response = _lookup_valid_invite(invite_token)
    if error_response:
        return error_response

    # Find user by invite email
    try:
        user = User.objects.get(email__iexact=invite.email, is_active=True)
    except User.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "No account found for this email.", "fields": {}}},
            status=404,
        )

    # Password confirmation
    if not user.check_password(password):
        return Response(
            {"error": {"code": "invalid_credentials", "message": "Invalid password.", "fields": {}}},
            status=401,
        )

    # Edge case: user is already in the target org
    existing_membership = (
        OrganizationMembership.objects.select_related("organization")
        .filter(user=user)
        .first()
    )
    if existing_membership and existing_membership.organization_id == invite.organization_id:
        # Idempotent — consume token and return current context
        invite.consumed_at = timezone.now()
        invite.save(update_fields=["consumed_at"])
        return Response({"data": _build_auth_response_payload(user, existing_membership)})

    # Move membership to new org
    with transaction.atomic():
        if existing_membership:
            previous_org_id = existing_membership.organization_id
            previous_role = existing_membership.role
            existing_membership.organization = invite.organization
            existing_membership.role = invite.role
            existing_membership.role_template = invite.role_template
            existing_membership.status = OrganizationMembership.Status.ACTIVE
            existing_membership.save(update_fields=[
                "organization", "role", "role_template", "status", "updated_at",
            ])
            OrganizationMembershipRecord.record(
                membership=existing_membership,
                event_type=OrganizationMembershipRecord.EventType.ROLE_CHANGED,
                capture_source=OrganizationMembershipRecord.CaptureSource.MANUAL_UI,
                recorded_by=user,
                from_status=OrganizationMembership.Status.ACTIVE,
                to_status=OrganizationMembership.Status.ACTIVE,
                from_role=previous_role,
                to_role=invite.role,
                note=f"Membership moved from org {previous_org_id} to org {invite.organization_id} via invite acceptance (Flow C).",
                metadata={"invite_id": invite.id, "previous_organization_id": previous_org_id},
            )
            membership = existing_membership
        else:
            # Edge case: user has no membership at all (shouldn't happen normally)
            membership = OrganizationMembership.objects.create(
                organization=invite.organization,
                user=user,
                role=invite.role,
                role_template=invite.role_template,
                status=OrganizationMembership.Status.ACTIVE,
            )
            OrganizationMembershipRecord.record(
                membership=membership,
                event_type=OrganizationMembershipRecord.EventType.CREATED,
                capture_source=OrganizationMembershipRecord.CaptureSource.MANUAL_UI,
                recorded_by=user,
                from_status=None,
                to_status=OrganizationMembership.Status.ACTIVE,
                from_role="",
                to_role=invite.role,
                note="Membership created via invite acceptance (Flow C: existing user, no prior membership).",
                metadata={"invite_id": invite.id},
            )

        invite.consumed_at = timezone.now()
        invite.save(update_fields=["consumed_at"])

    # Reload for response
    membership = OrganizationMembership.objects.select_related("organization").get(id=membership.id)
    return Response({"data": _build_auth_response_payload(user, membership)})


_VERIFY_ERROR_MAP = {
    "not_found": (404, "not_found", "Invalid verification link."),
    "consumed": (410, "consumed", "This link is no longer active. If you\u2019ve already verified, sign in instead."),
    "expired": (410, "expired", "This verification link has expired. Request a new one."),
}


@api_view(["POST"])
@permission_classes([AllowAny])
def verify_email_view(request):
    """Consume a verification token and authenticate the user.

    The verification link is the user's first login — clicking it both
    verifies email ownership and returns an auth payload.

    Contract:
    - `POST`:
      - `200`: token consumed, auth payload returned.
      - `400`: token field missing.
      - `404`: token not found.
      - `410`: token expired or already consumed.

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `POST`:
        - Creates: auth token (if missing), organization/membership (if missing).
        - Edits: `consumed_at` set on verification token.

    - Incoming payload (`POST`) shape:
      - JSON map: { "token": "string (required)" }

    - Test anchors:
      - `backend/core/tests/test_email_verification.py::VerifyEmailTests`
    """
    token_str = (request.data.get("token") or "").strip()
    if not token_str:
        return Response(
            {"error": {"code": "validation_error", "message": "token is required."}},
            status=400,
        )

    token_obj, error_code = EmailVerificationToken.lookup_valid(token_str)
    if error_code:
        status, code, message = _VERIFY_ERROR_MAP[error_code]
        return Response({"error": {"code": code, "message": message}}, status=status)

    token_obj.consumed_at = timezone.now()
    token_obj.save(update_fields=["consumed_at"])

    user = token_obj.user
    user.is_active = True
    user.save(update_fields=["is_active"])

    membership = _ensure_membership(user)
    return Response({"data": _build_auth_response_payload(user, membership)})


@api_view(["POST"])
@permission_classes([AllowAny])
def resend_verification_view(request):
    """Resend a verification email. Anti-enumeration: always returns 200.

    Rate-limited: if the most recent token was created less than 60 seconds
    ago, returns 429.

    Contract:
    - `POST`:
      - `200`: always (anti-enumeration). Email sent if applicable.
      - `400`: email field missing.
      - `429`: rate limited (last token <60s old).

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `POST`:
        - Creates: new `EmailVerificationToken`, `EmailRecord`.
        - Edits: none.

    - Incoming payload (`POST`) shape:
      - JSON map: { "email": "string (required)" }

    - Test anchors:
      - `backend/core/tests/test_email_verification.py::ResendVerificationTests`
    """
    email = (request.data.get("email") or "").strip().lower()
    if not email:
        return Response(
            {"error": {"code": "validation_error", "message": "email is required."}},
            status=400,
        )

    _RESEND_OK = {"data": {"message": "If that email is registered, a verification link has been sent."}}

    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return Response(_RESEND_OK, status=200)

    from datetime import timedelta

    # Already verified — send a password reset email instead.
    if user.is_active:
        latest_token = (
            PasswordResetToken.objects.filter(user=user).order_by("-created_at").first()
        )
        if latest_token and (timezone.now() - latest_token.created_at) < timedelta(seconds=60):
            wait_seconds = 60 - int((timezone.now() - latest_token.created_at).total_seconds())
            return Response(
                {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
                status=429,
            )
        PasswordResetToken.objects.filter(user=user, consumed_at__isnull=True).delete()
        token_obj = PasswordResetToken(user=user, email=user.email)
        token_obj.save()
        send_password_reset_email(user, token_obj)
        return Response(_RESEND_OK, status=200)

    # Rate limit: most recent token must be >60s old.
    latest_token = (
        EmailVerificationToken.objects.filter(user=user).order_by("-created_at").first()
    )
    if latest_token and (timezone.now() - latest_token.created_at) < timedelta(seconds=60):
        wait_seconds = 60 - int((timezone.now() - latest_token.created_at).total_seconds())
        return Response(
            {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
            status=429,
        )

    # Delete any previous unconsumed tokens so only the latest link works.
    EmailVerificationToken.objects.filter(user=user, consumed_at__isnull=True).delete()

    token_obj = EmailVerificationToken(user=user, email=user.email)
    token_obj.save()
    send_verification_email(user, token_obj)

    return Response(_RESEND_OK, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def forgot_password_view(request):
    """Request a password reset email. Anti-enumeration: always returns 200.

    Rate-limited: if the most recent reset token was created less than
    60 seconds ago, returns 429.

    Contract:
    - `POST`:
      - `200`: always (anti-enumeration). Email sent if applicable.
      - `400`: email field missing.
      - `429`: rate limited (last token <60s old).

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `POST`:
        - Creates: new `PasswordResetToken`, `EmailRecord`.
        - Deletes: previous unconsumed `PasswordResetToken` for the user.

    - Incoming payload (`POST`) shape:
      - JSON map: { "email": "string (required)" }

    - Test anchors:
      - `backend/core/tests/test_password_reset.py::ForgotPasswordTests`
    """
    email = (request.data.get("email") or "").strip().lower()
    if not email:
        return Response(
            {"error": {"code": "validation_error", "message": "email is required."}},
            status=400,
        )

    _FORGOT_OK = {"data": {"message": "If that email is registered, a password reset link has been sent."}}

    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return Response(_FORGOT_OK, status=200)

    from datetime import timedelta

    # Unverified users can't reset passwords — send a verification email instead.
    if not user.is_active:
        latest_token = (
            EmailVerificationToken.objects.filter(user=user).order_by("-created_at").first()
        )
        if latest_token and (timezone.now() - latest_token.created_at) < timedelta(seconds=60):
            wait_seconds = 60 - int((timezone.now() - latest_token.created_at).total_seconds())
            return Response(
                {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
                status=429,
            )
        EmailVerificationToken.objects.filter(user=user, consumed_at__isnull=True).delete()
        token_obj = EmailVerificationToken(user=user, email=user.email)
        token_obj.save()
        send_verification_email(user, token_obj)
        return Response(_FORGOT_OK, status=200)

    # Rate limit: most recent token must be >60s old.
    latest_token = (
        PasswordResetToken.objects.filter(user=user).order_by("-created_at").first()
    )
    if latest_token and (timezone.now() - latest_token.created_at) < timedelta(seconds=60):
        wait_seconds = 60 - int((timezone.now() - latest_token.created_at).total_seconds())
        return Response(
            {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
            status=429,
        )

    # Delete any previous unconsumed tokens so only the latest link works.
    PasswordResetToken.objects.filter(user=user, consumed_at__isnull=True).delete()

    token_obj = PasswordResetToken(user=user, email=user.email)
    token_obj.save()
    send_password_reset_email(user, token_obj)

    return Response(_FORGOT_OK, status=200)


_RESET_ERROR_MAP = {
    "not_found": (404, "not_found", "Invalid password reset link."),
    "consumed": (410, "consumed", "This reset link has already been used."),
    "expired": (410, "expired", "This reset link has expired. Request a new one."),
}


@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password_view(request):
    """Consume a password reset token and set a new password.

    On success, returns an auth payload so the user is automatically
    logged in after resetting their password.

    Contract:
    - `POST`:
      - `200`: password reset, auth payload returned.
      - `400`: token or new_password field missing, or password too short.
      - `404`: token not found.
      - `410`: token expired or already consumed.

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `POST`:
        - Edits: `consumed_at` set on reset token, user password updated.

    - Incoming payload (`POST`) shape:
      - JSON map: { "token": "string (required)", "new_password": "string (required)" }

    - Test anchors:
      - `backend/core/tests/test_password_reset.py::ResetPasswordTests`
    """
    token_str = (request.data.get("token") or "").strip()
    new_password = (request.data.get("new_password") or "").strip()

    if not token_str:
        return Response(
            {"error": {"code": "validation_error", "message": "token is required."}},
            status=400,
        )
    if not new_password:
        return Response(
            {"error": {"code": "validation_error", "message": "new_password is required."}},
            status=400,
        )
    if len(new_password) < 8:
        return Response(
            {"error": {"code": "validation_error", "message": "Password must be at least 8 characters."}},
            status=400,
        )

    token_obj, error_code = PasswordResetToken.lookup_valid(token_str)
    if error_code:
        status, code, message = _RESET_ERROR_MAP[error_code]
        return Response({"error": {"code": code, "message": message}}, status=status)

    token_obj.consumed_at = timezone.now()
    token_obj.save(update_fields=["consumed_at"])

    user = token_obj.user
    user.set_password(new_password)
    user.save(update_fields=["password"])

    membership = _ensure_membership(user)
    return Response({"data": _build_auth_response_payload(user, membership)})


# ── impersonation ──


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def impersonate_start_view(request):
    """Start an impersonation session for a target user.

    Superuser-only. Creates an ImpersonationToken that lets the caller
    make requests as the target user. Returns the same auth payload
    shape as login so the frontend can swap sessions seamlessly.

    Contract:
    - `POST`:
      - `200`: impersonation token + target user auth payload returned.
      - `400`: user_id missing.
      - `403`: caller is not a superuser, or target is a superuser.
      - `404`: target user not found.

    - Preconditions:
      - caller must be authenticated and ``is_superuser=True``.

    - Object mutations:
      - `POST`:
        - Creates: ``ImpersonationToken``.

    - Incoming payload (`POST`) shape:
      - JSON map: { "user_id": int (required) }
    """
    if not request.user.is_superuser:
        return Response(
            {"error": {"code": "forbidden", "message": "Superuser access required."}},
            status=403,
        )

    user_id = request.data.get("user_id")
    if not user_id:
        return Response(
            {"error": {"code": "validation_error", "message": "user_id is required."}},
            status=400,
        )

    try:
        target_user = User.objects.get(id=user_id, is_active=True)
    except User.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "User not found."}},
            status=404,
        )

    if target_user.is_superuser:
        return Response(
            {"error": {"code": "forbidden", "message": "Cannot impersonate another superuser."}},
            status=403,
        )

    # Clean up any existing impersonation tokens for this superuser.
    ImpersonationToken.objects.filter(impersonated_by=request.user).delete()

    imp_token = ImpersonationToken(user=target_user, impersonated_by=request.user)
    imp_token.save()

    membership = _ensure_membership(target_user)
    payload = _build_auth_response_payload(target_user, membership)
    # Override the token with the impersonation token key.
    payload["token"] = imp_token.key
    payload["impersonation"] = {
        "active": True,
        "real_email": request.user.email,
    }

    return Response({"data": payload})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def impersonate_exit_view(request):
    """End the current impersonation session.

    Deletes the impersonation token. The frontend should discard the
    impersonation token and restore the original superuser session.

    Contract:
    - `POST`:
      - `200`: impersonation session ended.
      - `400`: not currently impersonating.

    - Preconditions:
      - caller must be authenticated via an impersonation token.

    - Object mutations:
      - `POST`:
        - Deletes: the current ``ImpersonationToken``.
    """
    if not isinstance(request.auth, ImpersonationToken):
        return Response(
            {"error": {"code": "bad_request", "message": "Not currently impersonating."}},
            status=400,
        )

    request.auth.delete()
    return Response({"data": {"message": "Impersonation session ended."}})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def impersonate_users_view(request):
    """List users available for impersonation.

    Superuser-only. Returns all active non-superuser users with their
    org context, so the frontend can render a user picker.

    Contract:
    - `GET`:
      - `200`: list of impersonatable users returned.
      - `403`: caller is not a superuser.

    - Preconditions:
      - caller must be authenticated and ``is_superuser=True``.

    - Object mutations:
      - `GET`: none.
    """
    if not request.user.is_superuser:
        return Response(
            {"error": {"code": "forbidden", "message": "Superuser access required."}},
            status=403,
        )

    users = (
        User.objects.filter(is_active=True, is_superuser=False)
        .select_related()
        .order_by("email")
    )

    result = []
    for user in users:
        membership = OrganizationMembership.objects.select_related("organization").filter(user=user).first()
        entry = {
            "id": user.id,
            "email": user.email,
        }
        if membership:
            entry["organization"] = {
                "id": membership.organization_id,
                "display_name": membership.organization.display_name,
            }
            entry["role"] = membership.role
        result.append(entry)

    return Response({"data": result})
