from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import FinancialAuditEvent, Vendor, VendorBill
from core.serializers import VendorBillSerializer, VendorBillWriteSerializer
from core.views.helpers import (
    _record_financial_audit_event,
    _validate_project_for_user,
    _validate_vendor_bill_status_transition,
)


def _find_duplicate_vendor_bills(
    user,
    *,
    vendor_id: int,
    bill_number: str,
    exclude_vendor_bill_id=None,
):
    bill_number_norm = (bill_number or "").strip()
    if not vendor_id or not bill_number_norm:
        return []

    rows = VendorBill.objects.filter(
        created_by=user,
        vendor_id=vendor_id,
        bill_number__iexact=bill_number_norm,
    )
    if exclude_vendor_bill_id:
        rows = rows.exclude(id=exclude_vendor_bill_id)

    return list(rows.select_related("vendor", "project").order_by("-created_at", "-id"))


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_vendor_bills_view(request, project_id: int):
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            VendorBill.objects.filter(project=project, created_by=request.user)
            .select_related("project", "vendor")
            .order_by("-created_at")
        )
        return Response({"data": VendorBillSerializer(rows, many=True).data})

    serializer = VendorBillWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    fields = {}
    if "vendor" not in data:
        fields["vendor"] = ["This field is required."]
    if "bill_number" not in data:
        fields["bill_number"] = ["This field is required."]
    if "total" not in data:
        fields["total"] = ["This field is required."]
    if fields:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required fields for vendor bill creation.",
                    "fields": fields,
                }
            },
            status=400,
        )

    vendor = Vendor.objects.filter(id=data["vendor"], created_by=request.user).first()
    if not vendor:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Vendor is invalid for this user.",
                    "fields": {"vendor": ["Select a valid vendor."]},
                }
            },
            status=400,
        )

    issue_date = data.get("issue_date") or timezone.localdate()
    due_date = data.get("due_date") or (issue_date + timedelta(days=30))
    if due_date < issue_date:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "due_date cannot be before issue_date.",
                    "fields": {"due_date": ["Due date must be on or after issue date."]},
                }
            },
            status=400,
        )

    duplicates = _find_duplicate_vendor_bills(
        request.user,
        vendor_id=vendor.id,
        bill_number=data["bill_number"],
    )
    duplicate_override = data.get("duplicate_override", False)
    if duplicates and not duplicate_override:
        return Response(
            {
                "error": {
                    "code": "duplicate_detected",
                    "message": "Possible duplicate vendor bills found by vendor + bill number.",
                    "fields": {},
                },
                "data": {
                    "duplicate_candidates": VendorBillSerializer(duplicates, many=True).data,
                    "allowed_resolutions": ["create_anyway"],
                },
            },
            status=409,
        )

    total = Decimal(str(data["total"]))
    vendor_bill = VendorBill.objects.create(
        project=project,
        vendor=vendor,
        bill_number=data["bill_number"],
        status=VendorBill.Status.DRAFT,
        issue_date=issue_date,
        due_date=due_date,
        total=total,
        balance_due=total,
        notes=data.get("notes", ""),
        created_by=request.user,
    )
    _record_financial_audit_event(
        project=project,
        event_type=FinancialAuditEvent.EventType.VENDOR_BILL_UPDATED,
        object_type="vendor_bill",
        object_id=vendor_bill.id,
        from_status="",
        to_status=VendorBill.Status.DRAFT,
        amount=vendor_bill.total,
        note="Vendor bill created.",
        created_by=request.user,
        metadata={"bill_number": vendor_bill.bill_number},
    )
    return Response(
        {
            "data": VendorBillSerializer(vendor_bill).data,
            "meta": {"duplicate_override_used": bool(duplicates and duplicate_override)},
        },
        status=201,
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def vendor_bill_detail_view(request, vendor_bill_id: int):
    try:
        vendor_bill = VendorBill.objects.select_related("project", "vendor").get(
            id=vendor_bill_id,
            created_by=request.user,
        )
    except VendorBill.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Vendor bill not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": VendorBillSerializer(vendor_bill).data})

    serializer = VendorBillWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    next_vendor_id = data.get("vendor", vendor_bill.vendor_id)
    next_bill_number = data.get("bill_number", vendor_bill.bill_number)
    next_vendor = Vendor.objects.filter(id=next_vendor_id, created_by=request.user).first()
    if not next_vendor:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Vendor is invalid for this user.",
                    "fields": {"vendor": ["Select a valid vendor."]},
                }
            },
            status=400,
        )

    duplicates = _find_duplicate_vendor_bills(
        request.user,
        vendor_id=next_vendor.id,
        bill_number=next_bill_number,
        exclude_vendor_bill_id=vendor_bill.id,
    )
    duplicate_override = data.get("duplicate_override", False)
    if duplicates and not duplicate_override:
        return Response(
            {
                "error": {
                    "code": "duplicate_detected",
                    "message": "Possible duplicate vendor bills found by vendor + bill number.",
                    "fields": {},
                },
                "data": {
                    "duplicate_candidates": VendorBillSerializer(duplicates, many=True).data,
                    "allowed_resolutions": ["create_anyway"],
                },
            },
            status=409,
        )

    previous_status = vendor_bill.status
    next_status = data.get("status", previous_status)
    status_changing = "status" in data
    if status_changing and not _validate_vendor_bill_status_transition(
        current_status=previous_status,
        next_status=next_status,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid vendor bill status transition: {previous_status} -> {next_status}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    next_issue_date = data.get("issue_date", vendor_bill.issue_date)
    next_due_date = data.get("due_date", vendor_bill.due_date)
    if next_due_date < next_issue_date:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "due_date cannot be before issue_date.",
                    "fields": {"due_date": ["Due date must be on or after issue date."]},
                }
            },
            status=400,
        )

    candidate_total = Decimal(str(data.get("total", vendor_bill.total)))
    candidate_balance_due = (
        Decimal("0") if next_status == VendorBill.Status.PAID else candidate_total
    )

    update_fields = ["updated_at"]
    if "vendor" in data:
        vendor_bill.vendor = next_vendor
        update_fields.append("vendor")
    if "bill_number" in data:
        vendor_bill.bill_number = data["bill_number"]
        update_fields.append("bill_number")
    if "issue_date" in data:
        vendor_bill.issue_date = data["issue_date"]
        update_fields.append("issue_date")
    if "due_date" in data:
        vendor_bill.due_date = data["due_date"]
        update_fields.append("due_date")
    if "total" in data:
        vendor_bill.total = data["total"]
        update_fields.append("total")
    if "notes" in data:
        vendor_bill.notes = data["notes"]
        update_fields.append("notes")
    if status_changing:
        vendor_bill.status = next_status
        update_fields.append("status")

    if candidate_balance_due != vendor_bill.balance_due:
        vendor_bill.balance_due = candidate_balance_due
        update_fields.append("balance_due")

    if len(update_fields) > 1:
        vendor_bill.save(update_fields=update_fields)
        if previous_status != next_status or "total" in data:
            _record_financial_audit_event(
                project=vendor_bill.project,
                event_type=FinancialAuditEvent.EventType.VENDOR_BILL_UPDATED,
                object_type="vendor_bill",
                object_id=vendor_bill.id,
                from_status=previous_status,
                to_status=next_status,
                amount=candidate_total,
                note="Vendor bill updated.",
                created_by=request.user,
                metadata={
                    "bill_number": vendor_bill.bill_number,
                    "status_changed": previous_status != next_status,
                },
            )

    return Response(
        {
            "data": VendorBillSerializer(vendor_bill).data,
            "meta": {"duplicate_override_used": bool(duplicates and duplicate_override)},
        }
    )
