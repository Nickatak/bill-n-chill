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
    """List organization-scoped cost codes or create a new one.

    GET returns all cost codes for the user's org, ordered by code then name.
    POST creates a new cost code after checking for duplicate codes (case-insensitive).
    The duplicate check has a race-safe ``IntegrityError`` fallback.

    Flow (GET):
        1. Scope to user's org.
        2. Return serialized cost codes.

    Flow (POST):
        1. Capability gate: ``cost_codes.create``.
        2. Validate via serializer.
        3. Check for duplicate code (case-insensitive).
        4. Create cost code (with ``IntegrityError`` fallback for race conditions).

    URL: ``GET/POST /api/v1/cost-codes/``

    Request body (POST)::

        { "code": "01-100", "name": "Framing" }

    Success 200 (GET)::

        { "data": [{ ... }, ...] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Validation error or duplicate code.
        - 403: Missing ``cost_codes.create`` capability.
    """
    scope_filter = _org_scope_filter(request.user)

    if request.method == "GET":
        cost_codes = CostCode.objects.filter(scope_filter).order_by("code", "name")
        return Response({"data": CostCodeSerializer(cost_codes, many=True).data})

    elif request.method == "POST":
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
            cost_code = serializer.save(
                created_by=request.user,
                organization_id=membership.organization_id,
            )
        except IntegrityError:
            # Race-safe fallback in case duplicate is inserted between pre-check and insert.
            return _duplicate_code_error_response()
        return Response({"data": CostCodeSerializer(cost_code).data}, status=201)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def cost_code_detail_view(request, cost_code_id):
    """Update mutable cost-code fields (name, is_active).

    The ``code`` field is immutable after creation — attempts to change it
    return a 400.  Sending the same code value is silently accepted.

    Flow:
        1. Capability gate: ``cost_codes.edit``.
        2. Look up cost code scoped to user's org.
        3. Reject if ``code`` field is being changed.
        4. Partial update via serializer.

    URL: ``PATCH /api/v1/cost-codes/<cost_code_id>/``

    Request body::

        { "name": "Updated Name", "is_active": false }

    Success 200::

        { "data": { ... } }

    Errors:
        - 400: Attempted to change immutable ``code`` field.
        - 403: Missing ``cost_codes.edit`` capability.
        - 404: Cost code not found.
    """
    permission_error, _ = _capability_gate(request.user, "cost_codes", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    scope_filter = _org_scope_filter(request.user)
    try:
        cost_code = CostCode.objects.get(scope_filter, id=cost_code_id)
    except CostCode.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Cost code not found.", "fields": {}}},
            status=404,
        )

    if "code" in request.data:
        incoming_code = str(request.data.get("code", "")).strip()
        if incoming_code and incoming_code != cost_code.code:
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

    serializer = CostCodeSerializer(cost_code, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response({"data": CostCodeSerializer(cost_code).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cost_codes_import_csv_view(request):
    """Import cost codes from CSV with preview (dry_run) and apply modes.

    Accepts raw CSV text with ``code`` and ``name`` columns.  In dry-run mode,
    validates and returns what would happen without writing.  In apply mode,
    creates new codes and updates existing ones (matched by code, case-insensitive).

    Flow:
        1. Capability gate: ``cost_codes.create``.
        2. Parse ``csv_text`` and ``dry_run`` from request body.
        3. Delegate to ``process_csv_import`` with row validation, lookup,
           create, update, and serialization callbacks.

    URL: ``POST /api/v1/cost-codes/import-csv/``

    Request body::

        { "csv_text": "code,name\\n01-100,Framing\\n...", "dry_run": true }

    Success 200::

        { "data": { "created": 2, "updated": 1, "skipped": 0, "rows": [{ ... }, ...] } }

    Errors:
        - 400: Invalid CSV (missing headers, empty rows, row validation failures).
        - 403: Missing ``cost_codes.create`` capability.
    """
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
