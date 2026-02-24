"""Shared operational vendor endpoints."""

import csv
from io import StringIO

from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Vendor
from core.serializers import VendorSerializer, VendorWriteSerializer
from core.views.helpers import (
    _ensure_primary_membership,
    _organization_user_ids,
    _parse_request_bool,
    _role_gate_error_payload,
)


def _vendor_scope_filter(user):
    membership = _ensure_primary_membership(user)
    actor_user_ids = _organization_user_ids(user)
    return Q(organization_id=membership.organization_id) | Q(
        organization__isnull=True,
        created_by_id__in=actor_user_ids,
    )


def _find_duplicate_vendors(user, *, name: str, email: str, exclude_vendor_id=None):
    rows = Vendor.objects.filter(_vendor_scope_filter(user))
    if exclude_vendor_id:
        rows = rows.exclude(id=exclude_vendor_id)

    name_norm = (name or "").strip()
    email_norm = (email or "").strip().lower()
    query = Q()
    if name_norm:
        query |= Q(name__iexact=name_norm)
    if email_norm:
        query |= Q(email__iexact=email_norm)

    if not query:
        return []
    return list(rows.filter(query).order_by("name", "id"))


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
        return Response({"data": VendorSerializer(rows, many=True).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_primary_membership(request.user)
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
        vendor_type=data.get("vendor_type", Vendor.VendorType.TRADE),
        email=data.get("email", ""),
        phone=data.get("phone", ""),
        tax_id_last4=data.get("tax_id_last4", ""),
        notes=data.get("notes", ""),
        is_active=data.get("is_active", True),
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

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
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
    if "vendor_type" in data:
        vendor.vendor_type = data["vendor_type"]
        update_fields.append("vendor_type")
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
    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    csv_text = request.data.get("csv_text", "")
    dry_run = _parse_request_bool(request.data.get("dry_run", True), default=True)
    membership = _ensure_primary_membership(request.user)
    scope_filter = _vendor_scope_filter(request.user)
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
    expected_headers = {"name", "vendor_type", "email", "phone", "tax_id_last4", "notes", "is_active"}
    incoming_headers = set(reader.fieldnames or [])
    if "name" not in incoming_headers:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "CSV headers are invalid for vendor import.",
                    "fields": {"headers": [f"Expected at least: name. Optional: vendor_type,email,phone,tax_id_last4,notes,is_active. Found: {', '.join(sorted(incoming_headers))}"]},
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
        name = (row.get("name") or "").strip()
        vendor_type = (row.get("vendor_type") or Vendor.VendorType.TRADE).strip().lower()
        email = (row.get("email") or "").strip()
        phone = (row.get("phone") or "").strip()
        tax_id_last4 = (row.get("tax_id_last4") or "").strip()
        notes = (row.get("notes") or "").strip()
        is_active_raw = (row.get("is_active") or "true").strip().lower()

        if not name:
            error_count += 1
            rows_out.append(
                {"row_number": index, "name": name, "status": "error", "message": "name is required."}
            )
            continue
        if vendor_type not in {Vendor.VendorType.TRADE, Vendor.VendorType.RETAIL}:
            error_count += 1
            rows_out.append(
                {
                    "row_number": index,
                    "name": name,
                    "status": "error",
                    "message": "vendor_type must be trade or retail.",
                }
            )
            continue
        if is_active_raw not in {"true", "false", "1", "0", "yes", "no"}:
            error_count += 1
            rows_out.append(
                {
                    "row_number": index,
                    "name": name,
                    "status": "error",
                    "message": "is_active must be true/false.",
                }
            )
            continue
        is_active = is_active_raw in {"true", "1", "yes"}

        existing = Vendor.objects.filter(scope_filter, name__iexact=name).first()
        if existing:
            if dry_run:
                rows_out.append(
                    {
                        "row_number": index,
                        "name": name,
                        "status": "would_update",
                        "message": f"Would update vendor #{existing.id}.",
                    }
                )
            else:
                existing.vendor_type = vendor_type
                existing.email = email
                existing.phone = phone
                existing.tax_id_last4 = tax_id_last4
                existing.notes = notes
                existing.is_active = is_active
                existing.save(
                    update_fields=[
                        "vendor_type",
                        "email",
                        "phone",
                        "tax_id_last4",
                        "notes",
                        "is_active",
                        "updated_at",
                    ]
                )
                updated_count += 1
                rows_out.append(
                    {
                        "row_number": index,
                        "name": name,
                        "status": "updated",
                        "message": f"Updated vendor #{existing.id}.",
                    }
                )
            continue

        if dry_run:
            rows_out.append(
                {
                    "row_number": index,
                    "name": name,
                    "status": "would_create",
                    "message": "Would create new vendor.",
                }
            )
        else:
            Vendor.objects.create(
                created_by=request.user,
                organization_id=membership.organization_id,
                name=name,
                vendor_type=vendor_type,
                email=email,
                phone=phone,
                tax_id_last4=tax_id_last4,
                notes=notes,
                is_active=is_active,
            )
            created_count += 1
            rows_out.append(
                {"row_number": index, "name": name, "status": "created", "message": "Created vendor."}
            )

    return Response(
        {
            "data": {
                "entity": "vendors",
                "mode": "preview" if dry_run else "apply",
                "total_rows": len(rows_out),
                "created_count": created_count,
                "updated_count": updated_count,
                "error_count": error_count,
                "rows": rows_out,
            }
        }
    )
