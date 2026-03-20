"""Shared operational cost-code endpoints."""

from django.db import IntegrityError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import CostCode
from core.serializers import CostCodeSerializer
from core.utils.csv_import import CsvImportError, process_csv_import
from core.views.helpers import (
    _ensure_org_membership,
    _parse_request_bool,
    _capability_gate,
)
from core.views.shared_operations.cost_codes_helpers import (
    _org_scope_filter,
    _duplicate_code_error_response,
)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def cost_codes_list_create_view(request):
    """List organization-scoped cost codes or create a new cost code.

    Contract:
    - `GET`: organization/user-scoped list.
    - `POST`: requires role `owner|pm`.
    """
    scope_filter = _org_scope_filter(request.user)
    if request.method == "GET":
        rows = CostCode.objects.filter(scope_filter).order_by("code", "name")

        return Response({"data": CostCodeSerializer(rows, many=True).data})

    permission_error, _ = _capability_gate(request.user, "cost_codes", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = CostCodeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    membership = _ensure_org_membership(request.user)
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

    scope_filter = _org_scope_filter(request.user)
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

    scope_filter = _org_scope_filter(request.user)
    membership = _ensure_org_membership(request.user)
    csv_text = request.data.get("csv_text", "")
    dry_run = _parse_request_bool(request.data.get("dry_run", True), default=True)

    headers = {"code", "name"}

    def validate_row(row):
        if not row.get("code") or not row.get("name"):
            return "code and name are required."
        return None

    def lookup_existing(row):
        return CostCode.objects.filter(scope_filter, code__iexact=row["code"]).first()

    def create_cost_code(row):
        return CostCode.objects.create(
            created_by=request.user,
            organization_id=membership.organization_id,
            code=row["code"],
            name=row["name"],
            is_active=True,
        )

    def update_cost_code(existing, row):
        existing.name = row["name"]
        existing.save(update_fields=["name", "updated_at"])
        return existing

    def serialize_row(_instance, status, row, row_number, message):
        return {
            "row_number": row_number,
            "code": row.get("code", ""),
            "name": row.get("name", ""),
            "status": status,
            "message": message,
        }

    try:
        rows_out, summary = process_csv_import(
            csv_text=csv_text,
            dry_run=dry_run,
            required_headers=headers,
            allowed_headers=headers,
            entity_name="cost code",
            lookup_existing_fn=lookup_existing,
            create_fn=create_cost_code,
            update_fn=update_cost_code,
            validate_row_fn=validate_row,
            serialize_row_fn=serialize_row,
        )
    except CsvImportError as exc:
        return Response(exc.error_payload, status=400)

    return Response({"data": {**summary, "rows": rows_out}})
