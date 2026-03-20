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
from core.views.helpers import _capability_gate, _ensure_org_membership


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def organization_invites_view(request):
    """List pending invites or create a new one for the caller's organization.

    GET returns all unconsumed, unexpired invites.  POST creates a new invite
    after validating the email, role, and optional role template.  Duplicate
    invites (same email + org, still active) are rejected with 409.

    Flow (GET):
        1. Capability gate: ``users.invite``.
        2. Return pending invites for user's org.

    Flow (POST):
        1. Capability gate: ``users.invite``.
        2. Validate email and role via serializer.
        3. If ``role_template_id`` provided, verify it belongs to the org or is system-level.
        4. Check for existing active invite for same email + org (409 if found).
        5. Create and return the invite.

    URL: ``GET/POST /api/v1/organization/invites/``

    Request body (POST)::

        { "email": "jane@example.com", "role": "pm", "role_template_id": 3 }

    Success 200 (GET)::

        { "data": { "invites": [{ ... }, ...] } }

    Success 201 (POST)::

        { "data": { "invite": { ... } } }

    Errors:
        - 400: Validation error (invalid email, role template not in org).
        - 403: Missing ``users.invite`` capability.
        - 404: Role template not found.
        - 409: Active invite already exists for this email.
    """
    permission_error, _ = _capability_gate(request.user, "users", "invite")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_org_membership(request.user)
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

    elif request.method == "POST":
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
        existing_invite = OrganizationInvite.objects.filter(
            organization=membership.organization,
            email__iexact=email,
            consumed_at__isnull=True,
            expires_at__gt=now,
        ).first()
        if existing_invite:
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
def organization_invite_detail_view(request, invite_id):
    """Revoke (delete) a pending organization invite.

    Flow:
        1. Capability gate: ``users.invite``.
        2. Look up invite scoped to user's org.
        3. Delete the invite.

    URL: ``DELETE /api/v1/organization/invites/<invite_id>/``

    Request body: (none)

    Success 204: (no body)

    Errors:
        - 403: Missing ``users.invite`` capability.
        - 404: Invite not found or not in caller's org.
    """
    permission_error, _ = _capability_gate(request.user, "users", "invite")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_org_membership(request.user)
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
