"""Shared operational cost-code endpoints."""

import csv
from io import StringIO

from django.db import IntegrityError
from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import CostCode
from core.serializers import CostCodeSerializer
from core.views.helpers import (
    _ensure_primary_membership,
    _organization_user_ids,
    _parse_request_bool,
    _capability_gate,
)


def _cost_code_scope_filter(user):
    membership = _ensure_primary_membership(user)
    actor_user_ids = _organization_user_ids(user)
    return Q(organization_id=membership.organization_id) | Q(
        organization__isnull=True,
        created_by_id__in=actor_user_ids,
    )


def _duplicate_code_error_response():
    return Response(
        {
            "error": {
                "code": "validation_error",
                "message": "A cost code with this code already exists in your organization.",
                "fields": {"code": ["Code must be unique within your organization."]},
            }
        },
        status=400,
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def cost_codes_list_create_view(request):
    """List organization-scoped cost codes or create a new cost code.

    Contract:
    - `GET`: organization/user-scoped list.
    - `POST`: requires role `owner|pm`.
    """
    scope_filter = _cost_code_scope_filter(request.user)
    if request.method == "GET":
        rows = CostCode.objects.filter(scope_filter).order_by("code", "name")
        return Response({"data": CostCodeSerializer(rows, many=True).data})

    permission_error, _ = _capability_gate(request.user, "cost_codes", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = CostCodeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    membership = _ensure_primary_membership(request.user)
    incoming_code = str(serializer.validated_data.get("code", "")).strip()
    if CostCode.objects.filter(
        organization_id=membership.organization_id,
        code__iexact=incoming_code,
    ).exists():
        return _duplicate_code_error_response()

    try:
        code = serializer.save(
            created_by=request.user,
            organization_id=membership.organization_id,
        )
    except IntegrityError:
        # Race-safe fallback in case duplicate is inserted between pre-check and insert.
        return _duplicate_code_error_response()
    return Response({"data": CostCodeSerializer(code).data}, status=201)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def cost_code_detail_view(request, cost_code_id: int):
    """Patch mutable cost-code fields while enforcing `code` immutability."""
    permission_error, _ = _capability_gate(request.user, "cost_codes", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    scope_filter = _cost_code_scope_filter(request.user)
    try:
        row = CostCode.objects.get(scope_filter, id=cost_code_id)
    except CostCode.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Cost code not found.", "fields": {}}},
            status=404,
        )

    if "code" in request.data:
        incoming_code = str(request.data.get("code", "")).strip()
        if incoming_code and incoming_code != row.code:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "code is immutable after creation.",
                        "fields": {
                            "code": ["Cost code identifier cannot be changed after creation."]
                        },
                    }
                },
                status=400,
            )

    serializer = CostCodeSerializer(row, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response({"data": CostCodeSerializer(row).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cost_codes_import_csv_view(request):
    """Import cost codes from CSV in preview/apply mode with header and row validation."""
    permission_error, _ = _capability_gate(request.user, "cost_codes", "create")
    if permission_error:
        return Response(permission_error, status=403)

    scope_filter = _cost_code_scope_filter(request.user)
    membership = _ensure_primary_membership(request.user)

    csv_text = request.data.get("csv_text", "")
    dry_run = _parse_request_bool(request.data.get("dry_run", True), default=True)
    if not csv_text or not str(csv_text).strip():
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "csv_text is required.",
                    "fields": {"csv_text": ["Provide CSV content with headers."]},
                }
            },
            status=400,
        )

    reader = csv.DictReader(StringIO(str(csv_text)))
    expected_headers = {"code", "name"}
    incoming_headers = set(reader.fieldnames or [])
    if not {"code", "name"}.issubset(incoming_headers):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "CSV headers are invalid for cost code import.",
                    "fields": {"headers": [f"Expected: code,name. Found: {', '.join(sorted(incoming_headers))}"]},
                }
            },
            status=400,
        )
    unknown_headers = incoming_headers - expected_headers
    if unknown_headers:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "CSV contains unsupported headers.",
                    "fields": {"headers": [f"Unsupported: {', '.join(sorted(unknown_headers))}."]},
                }
            },
            status=400,
        )

    rows_out = []
    created_count = 0
    updated_count = 0
    error_count = 0

    for index, row in enumerate(reader, start=2):
        code = (row.get("code") or "").strip()
        name = (row.get("name") or "").strip()
        if not code or not name:
            error_count += 1
            rows_out.append(
                {
                    "row_number": index,
                    "code": code,
                    "name": name,
                    "status": "error",
                    "message": "code and name are required.",
                }
            )
            continue
        existing = CostCode.objects.filter(scope_filter, code__iexact=code).first()
        if existing:
            if dry_run:
                rows_out.append(
                    {
                        "row_number": index,
                        "code": code,
                        "name": name,
                        "status": "would_update",
                        "message": f"Would update cost code #{existing.id}.",
                    }
                )
            else:
                existing.name = name
                existing.save(update_fields=["name", "updated_at"])
                updated_count += 1
                rows_out.append(
                    {
                        "row_number": index,
                        "code": code,
                        "name": name,
                        "status": "updated",
                        "message": f"Updated cost code #{existing.id}.",
                    }
                )
            continue

        if dry_run:
            rows_out.append(
                {
                    "row_number": index,
                    "code": code,
                    "name": name,
                    "status": "would_create",
                    "message": "Would create new cost code.",
                }
            )
        else:
            CostCode.objects.create(
                created_by=request.user,
                organization_id=membership.organization_id,
                code=code,
                name=name,
                is_active=True,
            )
            created_count += 1
            rows_out.append(
                {
                    "row_number": index,
                    "code": code,
                    "name": name,
                    "status": "created",
                    "message": "Created cost code.",
                }
            )

    return Response(
        {
            "data": {
                "entity": "cost_codes",
                "mode": "preview" if dry_run else "apply",
                "total_rows": len(rows_out),
                "created_count": created_count,
                "updated_count": updated_count,
                "error_count": error_count,
                "rows": rows_out,
            }
        }
    )
