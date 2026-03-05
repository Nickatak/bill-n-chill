"""Organization invite management endpoints (create, list, revoke)."""

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import OrganizationInvite, RoleTemplate
from core.serializers.organization_management import (
    OrganizationInviteCreateSerializer,
    OrganizationInviteSerializer,
)
from core.rbac import _capability_gate
from core.user_helpers import _ensure_membership


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def organization_invites_view(request):
    """List or create organization invites.

    Contract:
    - `GET`:
      - `200`: pending (unexpired, unconsumed) invites for caller's org.
        - Guarantees: only invites in caller's org are returned. `[APP]`
      - `403`: caller lacks `users.invite` capability.

    - `POST`:
      - `201`: invite created with token.
        - Guarantees: token is unique and URL-safe. `[APP]`
      - `400`: validation error (invalid email, bad role).
      - `403`: caller lacks `users.invite` capability.
      - `409`: unconsumed, unexpired invite already exists for this email+org.

    - Preconditions:
      - caller must be authenticated (`IsAuthenticated`).
      - caller must have `users.invite` capability.
    """
    permission_error, _ = _capability_gate(request.user, "users", "invite")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_membership(request.user)
    now = timezone.now()

    if request.method == "GET":
        invites = (
            OrganizationInvite.objects.select_related("invited_by", "role_template")
            .filter(
                organization=membership.organization,
                consumed_at__isnull=True,
                expires_at__gt=now,
            )
            .order_by("-created_at")
        )
        return Response(
            {"data": {"invites": OrganizationInviteSerializer(invites, many=True).data}}
        )

    # POST — create invite
    serializer = OrganizationInviteCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data["email"].lower().strip()
    invite_role = serializer.validated_data.get("role", "viewer")
    role_template_id = serializer.validated_data.get("role_template_id")

    # Validate role_template belongs to org or is system-level
    role_template = None
    if role_template_id:
        try:
            role_template = RoleTemplate.objects.get(
                id=role_template_id,
            )
            if role_template.organization_id and role_template.organization_id != membership.organization_id:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Role template does not belong to this organization.",
                            "fields": {},
                        }
                    },
                    status=400,
                )
        except RoleTemplate.DoesNotExist:
            return Response(
                {
                    "error": {
                        "code": "not_found",
                        "message": "Role template not found.",
                        "fields": {},
                    }
                },
                status=404,
            )

    # Check for existing active invite for same email + org
    existing = OrganizationInvite.objects.filter(
        organization=membership.organization,
        email__iexact=email,
        consumed_at__isnull=True,
        expires_at__gt=now,
    ).first()
    if existing:
        return Response(
            {
                "error": {
                    "code": "conflict",
                    "message": f"A pending invite already exists for {email}.",
                    "fields": {},
                }
            },
            status=409,
        )

    invite = OrganizationInvite(
        organization=membership.organization,
        email=email,
        role=invite_role,
        role_template=role_template,
        invited_by=request.user,
    )
    invite.save()

    return Response(
        {"data": {"invite": OrganizationInviteSerializer(invite).data}},
        status=201,
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def organization_invite_detail_view(request, invite_id: int):
    """Revoke (delete) a pending organization invite.

    Contract:
    - `DELETE`:
      - `204`: invite deleted.
      - `403`: caller lacks `users.invite` capability.
      - `404`: invite not found or not in caller's org.

    - Preconditions:
      - caller must be authenticated (`IsAuthenticated`).
      - caller must have `users.invite` capability.
    """
    permission_error, _ = _capability_gate(request.user, "users", "invite")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_membership(request.user)
    try:
        invite = OrganizationInvite.objects.get(
            id=invite_id,
            organization=membership.organization,
        )
    except OrganizationInvite.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Invite not found.",
                    "fields": {},
                }
            },
            status=404,
        )

    invite.delete()
    return Response(status=204)
