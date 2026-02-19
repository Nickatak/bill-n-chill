from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Vendor
from core.serializers import VendorSerializer, VendorWriteSerializer


def _find_duplicate_vendors(user, *, name: str, email: str, exclude_vendor_id=None):
    rows = Vendor.objects.filter(created_by=user)
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
    if request.method == "GET":
        rows = Vendor.objects.filter(created_by=request.user).order_by("name", "id")
        search = request.query_params.get("q", "").strip()
        if search:
            rows = rows.filter(
                Q(name__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
                | Q(tax_id_last4__icontains=search)
            )
        return Response({"data": VendorSerializer(rows, many=True).data})

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
    try:
        vendor = Vendor.objects.get(id=vendor_id, created_by=request.user)
    except Vendor.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Vendor not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": VendorSerializer(vendor).data})

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
