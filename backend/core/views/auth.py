"""Authentication and registration views with invite-flow support."""

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import (
    EmailVerificationToken,
    ImpersonationToken,
    OrganizationInvite,
    OrganizationMembership,
    OrganizationMembershipRecord,
    PasswordResetToken,
)
from core.serializers import LoginSerializer, RegisterSerializer
from core.user_helpers import _ensure_org_membership
from core.utils.email import send_password_reset_email, send_verification_email
from core.views.auth_helpers import (
    _RESET_ERROR_MAP,
    _VERIFY_ERROR_MAP,
    _build_auth_response_payload,
    _lookup_valid_invite,
    _send_duplicate_registration_email,
    _send_rate_limited_token_email,
)

User = get_user_model()


# ── views ──


@api_view(["GET"])
@permission_classes([AllowAny])
def health_view(_request):
    """Health probe endpoint used by infra and local readiness checks.

    Flow:
        1. Return static OK payload.

    URL: ``GET /api/v1/health/``

    Request body: (none)

    Success 200::

        { "data": { "status": "ok" } }
    """
    return Response({"data": {"status": "ok"}})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    """Authenticate credentials and return token + role/org context.

    Unverified users (``is_active=False``) are blocked with a 403.  Legacy users
    missing an org/membership get one auto-created via ``_ensure_org_membership``.

    Flow:
        1. Validate email + password via ``LoginSerializer``.
        2. Reject unverified users (403).
        3. Ensure org membership exists (self-heal for legacy users).
        4. Return auth payload (token, user, org, capabilities).

    URL: ``POST /api/v1/auth/login/``

    Request body::

        { "email": "string", "password": "string" }

    Success 200::

        { "data": { "token": "...", "user": {...}, "organization": {...}, "capabilities": {...} } }

    Errors:
        - 400: Invalid or missing credentials.
        - 403: Email not yet verified.
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

    membership = _ensure_org_membership(user)

    return Response({"data": _build_auth_response_payload(user, membership)})


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    """Register a new user account, with optional invite-based fast-track.

    Two flows depending on whether ``invite_token`` is provided:

    - **Flow A** (no invite): Creates inactive user + org, sends verification
      email.  Always returns the same 200 regardless of whether the email
      already exists (anti-enumeration).  Existing verified users get a
      password-reset security alert; unverified users get a re-send.
    - **Flow B** (with invite): Creates active user in the invited org with
      the invited role, consumes the invite token.  Returns auth payload
      immediately (invite proves email ownership).

    Flow (A):
        1. Validate email + password via ``RegisterSerializer``.
        2. If email exists, send contextual email (password reset or re-verify).
        3. Otherwise create inactive user + org + verification token.
        4. Send verification email (outside transaction — mail failure won't rollback).
        5. Return uniform "check your email" response.

    Flow (B):
        1. Validate email + password, look up invite token.
        2. Verify email matches the invite.
        3. Create user + membership in invited org (atomic).
        4. Consume invite token.
        5. Return auth payload (201).

    URL: ``POST /api/v1/auth/register/``

    Request body::

        { "email": "string", "password": "string", "invite_token": "string (optional)" }

    Success 200 (Flow A)::

        { "data": { "message": "Check your email to verify your account." } }

    Success 201 (Flow B)::

        { "data": { "token": "...", "user": {...}, "organization": {...}, "capabilities": {...} } }

    Errors:
        - 400: Invalid payload or invite email mismatch.
        - 404: Invite token not found.
        - 410: Invite token expired or already consumed.
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
            _ensure_org_membership(user)
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
    """Return the current user's profile with resolved role and org context.

    If the request is authenticated via an ``ImpersonationToken``, the response
    includes an ``impersonation`` block so the frontend can show the banner.

    Flow:
        1. Ensure org membership exists (self-heal for legacy users).
        2. Build standard auth payload.
        3. If impersonating, attach impersonation metadata.

    URL: ``GET /api/v1/auth/me/``

    Request body: (none)

    Success 200::

        { "data": { "token": "...", "user": {...}, "organization": {...}, "capabilities": {...} } }

    Errors:
        - 401: Not authenticated.
    """
    user = request.user
    membership = _ensure_org_membership(user)
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
    navigates to ``/register`` directly (without an invite link).  Returns the
    invite token so the frontend can switch to Flow B registration.

    Flow:
        1. Validate ``email`` query param.
        2. Look up unconsumed, unexpired invite for this email.
        3. Return org name, role, and invite token (or 404).

    URL: ``GET /api/v1/auth/check-invite/?email=...``

    Request body: (none — email passed as query param)

    Success 200::

        { "data": { "organization_name": "...", "role": "...", "invite_token": "..." } }

    Errors:
        - 400: Missing ``email`` query param.
        - 404: No pending invite for this email.
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

    Returns org name, invited email, role, and whether the email already has
    an account (determines Flow B vs Flow C on the frontend).

    Flow:
        1. Look up invite via ``_lookup_valid_invite``.
        2. Check if a user already exists for the invited email.
        3. Return invite context with ``is_existing_user`` flag.

    URL: ``GET /api/v1/auth/verify-invite/<token>/``

    Request body: (none)

    Success 200::

        { "data": { "organization_name": "...", "email": "...", "role": "...", "is_existing_user": true } }

    Errors:
        - 400: Missing token.
        - 404: Token not found.
        - 410: Token expired or already consumed.
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
    """Accept an invite as an existing user (Flow C).

    Moves the user's membership from their current org to the invited org.
    This is destructive (loses access to current org) so the user's password
    is required as confirmation.  If the user is already in the target org,
    the invite is consumed idempotently.

    Flow:
        1. Validate invite token and password.
        2. Look up active user by invite email.
        3. Confirm password.
        4. If already in target org, consume invite and return (idempotent).
        5. Move membership to invited org (atomic) + audit record.
        6. Consume invite token.
        7. Return auth payload.

    URL: ``POST /api/v1/auth/accept-invite/``

    Request body::

        { "invite_token": "string", "password": "string" }

    Success 200::

        { "data": { "token": "...", "user": {...}, "organization": {...}, "capabilities": {...} } }

    Errors:
        - 400: Missing ``invite_token`` or ``password``.
        - 401: Invalid password.
        - 404: Invite not found or no account for invite email.
        - 410: Invite expired or already consumed.
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


@api_view(["POST"])
@permission_classes([AllowAny])
def verify_email_view(request):
    """Consume an email verification token and authenticate the user.

    This is the user's first login — the verification link both confirms
    email ownership and returns a full auth payload.

    Flow:
        1. Validate the ``token`` field from the request body.
        2. Look up the verification token via ``EmailVerificationToken.lookup_valid``.
        3. Mark token consumed and activate the user (atomic).
        4. Ensure org membership exists.
        5. Return auth payload.

    URL: ``POST /api/v1/auth/verify-email/``

    Request body::

        { "token": "string" }

    Success 200::

        { "data": { "token": "...", "user": {...}, "organization": {...}, "capabilities": {...} } }

    Errors:
        - 400: Missing ``token``.
        - 404: Token not found.
        - 410: Token expired or already consumed.
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

    with transaction.atomic():
        token_obj.consumed_at = timezone.now()
        token_obj.save(update_fields=["consumed_at"])

        user = token_obj.user
        user.is_active = True
        user.save(update_fields=["is_active"])

    membership = _ensure_org_membership(user)
    return Response({"data": _build_auth_response_payload(user, membership)})


@api_view(["POST"])
@permission_classes([AllowAny])
def resend_verification_view(request):
    """Resend a verification email (or password reset if already verified).

    Anti-enumeration: always returns 200 for valid requests regardless of
    whether the email exists.  If the user is already verified, sends a
    password reset link instead (they don't need verification).

    Flow:
        1. Validate the ``email`` field.
        2. Look up user — if not found, return 200 (anti-enumeration).
        3. If already verified, send a rate-limited password reset email.
        4. If unverified, send a rate-limited verification email.

    URL: ``POST /api/v1/auth/resend-verification/``

    Request body::

        { "email": "string" }

    Success 200::

        { "data": { "message": "If that email is registered, a verification link has been sent." } }

    Errors:
        - 400: Missing ``email``.
        - 429: Rate limited (last token <60s old).
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

    # Already verified — send a password reset email instead.
    if user.is_active:
        wait_seconds = _send_rate_limited_token_email(
            user, PasswordResetToken, send_password_reset_email,
        )
        if wait_seconds is not None:
            return Response(
                {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
                status=429,
            )
        return Response(_RESEND_OK, status=200)

    wait_seconds = _send_rate_limited_token_email(
        user, EmailVerificationToken, send_verification_email,
    )
    if wait_seconds is not None:
        return Response(
            {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
            status=429,
        )

    return Response(_RESEND_OK, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def forgot_password_view(request):
    """Request a password reset email (or verification if not yet verified).

    Anti-enumeration: always returns 200 for valid requests regardless of
    whether the email exists.  If the user hasn't verified their email yet,
    sends a verification link instead (they need that first).

    Flow:
        1. Validate the ``email`` field.
        2. Look up user — if not found, return 200 (anti-enumeration).
        3. If unverified, send a rate-limited verification email.
        4. If verified, send a rate-limited password reset email.

    URL: ``POST /api/v1/auth/forgot-password/``

    Request body::

        { "email": "string" }

    Success 200::

        { "data": { "message": "If that email is registered, a password reset link has been sent." } }

    Errors:
        - 400: Missing ``email``.
        - 429: Rate limited (last token <60s old).
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

    # Unverified users can't reset passwords — send a verification email instead.
    if not user.is_active:
        wait_seconds = _send_rate_limited_token_email(
            user, EmailVerificationToken, send_verification_email,
        )
        if wait_seconds is not None:
            return Response(
                {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
                status=429,
            )
        return Response(_FORGOT_OK, status=200)

    wait_seconds = _send_rate_limited_token_email(
        user, PasswordResetToken, send_password_reset_email,
    )
    if wait_seconds is not None:
        return Response(
            {"error": {"code": "rate_limited", "message": f"Please wait {wait_seconds} seconds before requesting another email."}},
            status=429,
        )

    return Response(_FORGOT_OK, status=200)


@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password_view(request):
    """Consume a password reset token and set a new password.

    On success the user is automatically logged in — returns the same auth
    payload as login so the frontend can set the session immediately.

    Flow:
        1. Validate ``token`` and ``new_password`` fields (min 8 chars).
        2. Look up the reset token via ``PasswordResetToken.lookup_valid``.
        3. Mark token consumed and update user password (atomic).
        4. Ensure org membership exists.
        5. Return auth payload.

    URL: ``POST /api/v1/auth/reset-password/``

    Request body::

        { "token": "string", "new_password": "string" }

    Success 200::

        { "data": { "token": "...", "user": {...}, "organization": {...}, "capabilities": {...} } }

    Errors:
        - 400: Missing ``token`` or ``new_password``, or password < 8 characters.
        - 404: Token not found.
        - 410: Token expired or already consumed.
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

    with transaction.atomic():
        token_obj.consumed_at = timezone.now()
        token_obj.save(update_fields=["consumed_at"])

        user = token_obj.user
        user.set_password(new_password)
        user.save(update_fields=["password"])

    membership = _ensure_org_membership(user)
    return Response({"data": _build_auth_response_payload(user, membership)})


# ── impersonation ──


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def impersonate_start_view(request):
    """Start an impersonation session for a target user (superuser-only).

    Creates an ``ImpersonationToken`` and returns the target user's auth payload
    so the frontend can swap sessions seamlessly.  Any existing impersonation
    tokens for the calling superuser are cleaned up first.

    Flow:
        1. Verify caller is superuser.
        2. Look up target user (must be active, non-superuser).
        3. Delete any prior impersonation tokens for this superuser.
        4. Create new ``ImpersonationToken``.
        5. Return target user's auth payload with impersonation metadata.

    URL: ``POST /api/v1/auth/impersonate/start/``

    Request body::

        { "user_id": 123 }

    Success 200::

        { "data": { "token": "...", "user": {...}, "organization": {...}, "impersonation": { "active": true, "real_email": "..." } } }

    Errors:
        - 400: Missing ``user_id``.
        - 403: Caller is not a superuser, or target is a superuser.
        - 404: Target user not found.
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

    membership = _ensure_org_membership(target_user)
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

    Deletes the ``ImpersonationToken``.  The frontend should discard the
    token and restore the original superuser session.

    Flow:
        1. Verify request is authenticated via an impersonation token.
        2. Delete the token.

    URL: ``POST /api/v1/auth/impersonate/exit/``

    Request body: (none)

    Success 200::

        { "data": { "message": "Impersonation session ended." } }

    Errors:
        - 400: Not currently impersonating (request wasn't via an impersonation token).
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
    """List users available for impersonation (superuser-only).

    Returns all active non-superuser users with their org context so the
    frontend can render a user picker.

    Flow:
        1. Verify caller is superuser.
        2. Fetch all active non-superuser users with their memberships.
        3. Return user list with org context.

    URL: ``GET /api/v1/auth/impersonate/users/``

    Request body: (none)

    Success 200::

        { "data": [{ "id": 1, "email": "...", "organization": {...}, "role": "..." }, ...] }

    Errors:
        - 403: Caller is not a superuser.
    """
    if not request.user.is_superuser:
        return Response(
            {"error": {"code": "forbidden", "message": "Superuser access required."}},
            status=403,
        )

    users = (
        User.objects.filter(is_active=True, is_superuser=False)
        .order_by("email")
    )

    memberships_by_user = {}
    for m in OrganizationMembership.objects.select_related("organization").filter(user__in=users):
        memberships_by_user.setdefault(m.user_id, m)

    result = []
    for user in users:
        entry = {
            "id": user.id,
            "email": user.email,
        }
        membership = memberships_by_user.get(user.id)
        if membership:
            entry["organization"] = {
                "id": membership.organization_id,
                "display_name": membership.organization.display_name,
            }
            entry["role"] = membership.role
        result.append(entry)

    return Response({"data": result})
