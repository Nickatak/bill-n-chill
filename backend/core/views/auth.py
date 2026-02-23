from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.serializers import LoginSerializer, RegisterSerializer
from core.utils.runtime_metadata import get_app_revision, get_last_data_reset_at
from core.views.helpers import _ensure_primary_membership, _resolve_user_role

User = get_user_model()


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
    membership = _ensure_primary_membership(user)
    token, _ = Token.objects.get_or_create(user=user)

    return Response(
        {
            "data": {
                "token": token.key,
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "role": _resolve_user_role(user),
                },
                "organization": {
                    "id": membership.organization_id,
                    "display_name": membership.organization.display_name,
                    "slug": membership.organization.slug,
                },
            }
        }
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def register_view(request):
    """Registration endpoint: create user, bootstrap org membership, and return auth context.

    Contract:
    - `POST`:
      - `201`: user created and authenticated context returned.
        - Guarantees:
          - newly created user exists with email identity. `[APP]`
          - primary org membership context is available in response. `[APP]`
          - token exists for the newly created user. `[APP]`
      - `400`: registration payload invalid.
        - Guarantees: no user is created from the failed request. `[APP]`

    - Preconditions:
      - none (`AllowAny`).

    - Object mutations:
      - `POST`:
        - Creates:
          - Standard: `User` and bootstrap organization/membership context.
          - Audit: none.
        - Edits: none.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - JSON map:
        {
          "email": "string (required)",
          "password": "string (required)"
        }

    - Idempotency and retry semantics:
      - `POST` is not idempotent for unique identities.
      - retrying the same successful registration payload will fail validation once the identity already exists.

    - Test anchors:
      - `backend/core/tests/test_health_auth.py::test_register_creates_account_and_returns_token`
      - `backend/core/tests/test_health_auth.py::test_register_rejects_duplicate_email`
    """
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    email = serializer.validated_data["email"]
    password = serializer.validated_data["password"]
    user = User.objects.create_user(username=email, email=email, password=password)
    membership = _ensure_primary_membership(user)
    token, _ = Token.objects.get_or_create(user=user)

    return Response(
        {
            "data": {
                "token": token.key,
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "role": _resolve_user_role(user),
                },
                "organization": {
                    "id": membership.organization_id,
                    "display_name": membership.organization.display_name,
                    "slug": membership.organization.slug,
                },
            }
        },
        status=201,
    )


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
    membership = _ensure_primary_membership(user)
    return Response(
        {
            "data": {
                "id": user.id,
                "email": user.email,
                "role": _resolve_user_role(user),
                "organization": {
                    "id": membership.organization_id,
                    "display_name": membership.organization.display_name,
                    "slug": membership.organization.slug,
                },
            }
        }
    )
