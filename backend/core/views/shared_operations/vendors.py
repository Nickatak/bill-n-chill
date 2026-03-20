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
    _vendor_scope_filter,
)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def vendors_list_create_view(request):
    """List scoped vendors or create a vendor with duplicate-detection guardrails."""
    scope_filter = _vendor_scope_filter(request.user)
    if request.method == "GET":
        rows = Vendor.objects.filter(scope_filter).order_by("name", "id")
        search = request.query_params.get("q", "").strip()
        if search:
            rows = rows.filter(
                Q(name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
                | Q(tax_id_last4__icontains=search)
            )

        rows, meta = _paginate_queryset(rows, request.query_params)

        return Response({"data": VendorSerializer(rows, many=True).data, "meta": meta})

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

    if data.get("is_active") is False:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "New vendors must be active on creation.",
                    "fields": {"is_active": ["New vendors must be active on creation."]},
                }
            },
            status=400,
        )

    duplicates = _find_duplicate_vendors(
        request.user,
        name=data["name"],
        email=data.get("email", ""),
    )
    duplicate_override = data.get("duplicate_override", False)
    if duplicates and not duplicate_override:
        return Response(
            {
                "error": {
                    "code": "duplicate_detected",
                    "message": "Possible duplicate vendors found by name/email.",
                    "fields": {},
                },
                "data": {
                    "duplicate_candidates": VendorSerializer(duplicates, many=True).data,
                    "allowed_resolutions": ["create_anyway"],
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
        is_active=True,
        created_by=request.user,
    )
    return Response(
        {
            "data": VendorSerializer(vendor).data,
            "meta": {"duplicate_override_used": bool(duplicates and duplicate_override)},
        },
        status=201,
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def vendor_detail_view(request, vendor_id: int):
    """Fetch or patch one vendor with duplicate checks on identity-changing updates."""
    scope_filter = _vendor_scope_filter(request.user)
    try:
        vendor = Vendor.objects.get(scope_filter, id=vendor_id)
    except Vendor.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Vendor not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": VendorSerializer(vendor).data})

    permission_error, _ = _capability_gate(request.user, "vendors", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = VendorWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    next_name = data.get("name", vendor.name)
    next_email = data.get("email", vendor.email)
    duplicates = _find_duplicate_vendors(
        request.user,
        name=next_name,
        email=next_email,
        exclude_vendor_id=vendor.id,
    )
    duplicate_override = data.get("duplicate_override", False)
    if duplicates and not duplicate_override:
        return Response(
            {
                "error": {
                    "code": "duplicate_detected",
                    "message": "Possible duplicate vendors found by name/email.",
                    "fields": {},
                },
                "data": {
                    "duplicate_candidates": VendorSerializer(duplicates, many=True).data,
                    "allowed_resolutions": ["create_anyway"],
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
    if "is_active" in data:
        vendor.is_active = data["is_active"]
        update_fields.append("is_active")

    if len(update_fields) > 1:
        vendor.save(update_fields=update_fields)

    return Response(
        {
            "data": VendorSerializer(vendor).data,
            "meta": {"duplicate_override_used": bool(duplicates and duplicate_override)},
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def vendors_import_csv_view(request):
    """Import vendors from CSV in preview/apply mode with strict header validation."""
    permission_error, _ = _capability_gate(request.user, "vendors", "create")
    if permission_error:
        return Response(permission_error, status=403)

    csv_text = request.data.get("csv_text", "")
    dry_run = _parse_request_bool(request.data.get("dry_run", True), default=True)
    membership = _ensure_org_membership(request.user)
    scope_filter = _vendor_scope_filter(request.user)

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
            is_active=True,
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
