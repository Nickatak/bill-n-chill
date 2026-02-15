from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.serializers import LoginSerializer


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
    token, _ = Token.objects.get_or_create(user=user)

    return Response(
        {
            "data": {
                "token": token.key,
                "user": {
                    "id": user.id,
                    "email": user.email,
                },
            }
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me_view(request):
    user = request.user
    return Response({"data": {"id": user.id, "email": user.email}})
