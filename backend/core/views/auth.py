from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.serializers import LoginSerializer, RegisterSerializer
from core.views.helpers import _ensure_primary_membership, _resolve_user_role

User = get_user_model()


@api_view(["GET"])
@permission_classes([AllowAny])
def health_view(_request):
    return Response({"data": {"status": "ok"}})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
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
