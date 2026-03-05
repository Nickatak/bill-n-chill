from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import OrganizationInvite, OrganizationMembership, OrganizationMembershipRecord
from core.serializers import LoginSerializer, RegisterSerializer
from core.utils.runtime_metadata import (
    get_app_build_at,
    get_app_revision,
    get_last_data_reset_at,
)
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
        },
        "organization": {
            "id": membership.organization_id,
            "display_name": membership.organization.display_name,
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
    return Response(
        {
            "data": {
                "status": "ok",
                "app_revision": get_app_revision(),
                "app_build_at": get_app_build_at(),
                "data_reset_at": get_last_data_reset_at(),
            }
        }
    )


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
    membership = _ensure_membership(user)

    return Response({"data": _build_auth_response_payload(user, membership)})


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    """Registration endpoint: create user, bootstrap org membership, and return auth context.

    Supports two flows:
    - Flow A (no invite_token): Standard registration — creates user + new org + owner membership.
    - Flow B (with invite_token): Invited registration — creates user, joins invited org with
      invited role, skips org creation, consumes invite token.

    Contract:
    - `POST`:
      - `201`: user created and authenticated context returned.
        - Guarantees:
          - newly created user exists with email identity. `[APP]`
          - primary org membership context is available in response. `[APP]`
          - token exists for the newly created user. `[APP]`
      - `400`: registration payload invalid or invite email mismatch.
        - Guarantees: no user is created from the failed request. `[APP]`
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
      - `backend/core/tests/test_health_auth.py::test_register_creates_account_and_returns_token`
      - `backend/core/tests/test_health_auth.py::test_register_rejects_duplicate_email`
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

    # Flow A: standard registration (no invite)
    user = User.objects.create_user(username=email, email=email, password=password)
    membership = _ensure_membership(user)

    return Response({"data": _build_auth_response_payload(user, membership)}, status=201)


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
    return Response({"data": _build_auth_response_payload(user, membership)})


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
