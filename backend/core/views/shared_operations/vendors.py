"""Shared operational vendor endpoints."""

from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Vendor
from core.serializers import VendorSerializer, VendorWriteSerializer
from core.utils.csv_import import CsvImportError, process_csv_import
from core.views.helpers import (
    _ensure_org_membership,
    _paginate_queryset,
    _parse_request_bool,
    _capability_gate,
)
from core.views.shared_operations.vendors_helpers import (
    _find_duplicate_vendors,
    _org_scope_filter,
)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def vendors_list_create_view(request):
    """List scoped vendors or create a new vendor with duplicate detection.

    GET returns a paginated, searchable vendor list filtered by text query
    across name, email, phone, and tax ID.  POST creates a vendor with
    duplicate-detection guardrails — if an exact name match is found the
    request is rejected (no override path).

    Flow (GET):
        1. Scope to user's org.
        2. Apply optional text search filter.
        3. Paginate and return.

    Flow (POST):
        1. Capability gate: ``vendors.create``.
        2. Validate required fields (name) and creation constraints.
        3. Check for duplicate vendors by name/email.
        4. If duplicates found and no override, return 409 with candidates.
        5. Create vendor and return.

    URL: ``GET/POST /api/v1/vendors/``

    Request body (POST)::

        { "name": "Acme Supply", "email": "info@acme.com" }

    Success 200 (GET)::

        { "data": [{ ... }], "meta": { "page": 1, "page_size": 25, ... } }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Missing name or inactive-on-create.
        - 403: Missing ``vendors.create`` capability.
        - 409: Duplicate detected (with candidate list).
    """
    scope_filter = _org_scope_filter(request.user)

    if request.method == "GET":
        vendors = Vendor.objects.filter(scope_filter).order_by("name", "id")
        search = request.query_params.get("q", "").strip()
        if search:
            vendors = vendors.filter(
                Q(name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
                | Q(tax_id_last4__icontains=search)
            )

        vendors, pagination = _paginate_queryset(vendors, request.query_params)

        return Response({"data": VendorSerializer(vendors, many=True).data, "pagination_metadata": pagination})

    elif request.method == "POST":
        permission_error, _ = _capability_gate(request.user, "vendors", "create")
        if permission_error:
            return Response(permission_error, status=403)

        membership = _ensure_org_membership(request.user)
        serializer = VendorWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "name" not in data:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "name is required for vendor creation.",
                        "fields": {"name": ["This field is required."]},
                    }
                },
                status=400,
            )

        duplicates = _find_duplicate_vendors(request.user, name=data["name"])
        if duplicates:
            return Response(
                {
                    "error": {
                        "code": "duplicate_detected",
                        "message": (
                            "A vendor with this name already exists. "
                            "To distinguish them, add a location or qualifier "
                            '(e.g. "ABC Plumbing — Westside").'
                        ),
                        "fields": {},
                    },
                    "data": {
                        "duplicate_candidates": VendorSerializer(duplicates, many=True).data,
                    },
                },
                status=409,
            )

        vendor = Vendor.objects.create(
            organization_id=membership.organization_id,
            name=data["name"],
            email=data.get("email", ""),
            phone=data.get("phone", ""),
            tax_id_last4=data.get("tax_id_last4", ""),
            notes=data.get("notes", ""),
            created_by=request.user,
        )
        return Response(
            {"data": VendorSerializer(vendor).data},
            status=201,
        )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def vendor_detail_view(request, vendor_id):
    """Fetch or update a single vendor profile.

    GET returns the vendor.  PATCH applies partial updates with
    duplicate-detection guardrails on vendor name.  If an exact name
    match is found the request is rejected (no override path).

    Flow (GET):
        1. Look up vendor scoped to user's org.
        2. Return serialized vendor.

    Flow (PATCH):
        1. Capability gate: ``vendors.edit``.
        2. Validate incoming fields.
        3. Check for duplicates against next name/email.
        4. If duplicates found and no override, return 409 with candidates.
        5. Apply field updates and save.

    URL: ``GET/PATCH /api/v1/vendors/<vendor_id>/``

    Request body (PATCH)::

        { "name": "Acme Supply Co" }

    Success 200::

        { "data": { ... } }

    Errors:
        - 403: Missing ``vendors.edit`` capability.
        - 404: Vendor not found.
        - 409: Duplicate detected (with candidate list).
    """
    scope_filter = _org_scope_filter(request.user)
    try:
        vendor = Vendor.objects.get(scope_filter, id=vendor_id)
    except Vendor.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Vendor not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": VendorSerializer(vendor).data})

    elif request.method == "PATCH":
        permission_error, _ = _capability_gate(request.user, "vendors", "edit")
        if permission_error:
            return Response(permission_error, status=403)

        serializer = VendorWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        next_name = data.get("name", vendor.name)
        duplicates = _find_duplicate_vendors(
            request.user,
            name=next_name,
            exclude_vendor_id=vendor.id,
        )
        if duplicates:
            return Response(
                {
                    "error": {
                        "code": "duplicate_detected",
                        "message": (
                            "A vendor with this name already exists. "
                            "To distinguish them, add a location or qualifier "
                            '(e.g. "ABC Plumbing — Westside").'
                        ),
                        "fields": {},
                    },
                    "data": {
                        "duplicate_candidates": VendorSerializer(duplicates, many=True).data,
                    },
                },
                status=409,
            )

        update_fields = ["updated_at"]
        if "name" in data:
            vendor.name = data["name"]
            update_fields.append("name")
        if "email" in data:
            vendor.email = data["email"]
            update_fields.append("email")
        if "phone" in data:
            vendor.phone = data["phone"]
            update_fields.append("phone")
        if "tax_id_last4" in data:
            vendor.tax_id_last4 = data["tax_id_last4"]
            update_fields.append("tax_id_last4")
        if "notes" in data:
            vendor.notes = data["notes"]
            update_fields.append("notes")
        if len(update_fields) > 1:
            vendor.save(update_fields=update_fields)

        return Response({"data": VendorSerializer(vendor).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def vendors_import_csv_view(request):
    """Import vendors from a CSV payload in preview or apply mode.

    Accepts raw CSV text with required ``name`` header.  In dry-run mode
    (default) returns a preview of what would be created/updated without
    persisting.  In apply mode, creates new vendors and updates existing
    ones matched by name (case-insensitive).

    Flow:
        1. Capability gate: ``vendors.create``.
        2. Parse CSV text and validate headers.
        3. For each row: validate, look up existing vendor by name, create or update.
        4. Return per-row results and summary counts.

    URL: ``POST /api/v1/vendors/import-csv/``

    Request body::

        { "csv_text": "name,email\\nAcme,info@acme.com", "dry_run": true }

    Success 200::

        { "data": { "created": 1, "updated": 0, "skipped": 0, "rows": [...] } }

    Errors:
        - 400: Missing/invalid headers or row validation failure.
        - 403: Missing ``vendors.create`` capability.
    """
    permission_error, _ = _capability_gate(request.user, "vendors", "create")
    if permission_error:
        return Response(permission_error, status=403)

    csv_text = request.data.get("csv_text", "")
    dry_run = _parse_request_bool(request.data.get("dry_run", True), default=True)
    membership = _ensure_org_membership(request.user)
    scope_filter = _org_scope_filter(request.user)

    def validate_row(row):
        if not row.get("name"):
            return "name is required."
        return None

    def lookup_existing(row):
        return Vendor.objects.filter(scope_filter, name__iexact=row["name"]).first()

    def create_vendor(row):
        return Vendor.objects.create(
            created_by=request.user,
            organization_id=membership.organization_id,
            name=row["name"],
            email=row.get("email", ""),
            phone=row.get("phone", ""),
            tax_id_last4=row.get("tax_id_last4", ""),
            notes=row.get("notes", ""),
        )

    def update_vendor(existing, row):
        existing.email = row.get("email", "")
        existing.phone = row.get("phone", "")
        existing.tax_id_last4 = row.get("tax_id_last4", "")
        existing.notes = row.get("notes", "")
        existing.save(
            update_fields=["email", "phone", "tax_id_last4", "notes", "updated_at"]
        )
        return existing

    def serialize_row(_instance, status, row, row_number, message):
        return {"row_number": row_number, "name": row.get("name", ""), "status": status, "message": message}

    try:
        rows_out, summary = process_csv_import(
            csv_text=csv_text,
            dry_run=dry_run,
            required_headers={"name"},
            allowed_headers={"name", "email", "phone", "tax_id_last4", "notes"},
            entity_name="vendor",
            lookup_existing_fn=lookup_existing,
            create_fn=create_vendor,
            update_fn=update_vendor,
            validate_row_fn=validate_row,
            serialize_row_fn=serialize_row,
        )
    except CsvImportError as exc:
        return Response(exc.error_payload, status=400)

    return Response({"data": {**summary, "rows": rows_out}})
