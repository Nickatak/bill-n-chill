"""Accounts payable vendor-bill endpoints and line item lifecycle."""

from datetime import timedelta

from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Vendor,
    VendorBill,
    VendorBillSnapshot,
)
from core.policies import get_vendor_bill_policy_contract
from core.serializers import VendorBillSerializer, VendorBillSnapshotSerializer, VendorBillWriteSerializer
from core.utils.money import quantize_money
from core.views.accounts_payable.vendor_bills_helpers import (
    _apply_vendor_bill_lines_and_totals,
    _find_duplicate_vendor_bills,
    _handle_vb_document_save,
    _handle_vb_status_note,
    _handle_vb_status_transition,
    _prefetch_vendor_bill_qs,
    _vendor_bill_line_apply_error_response,
)
from core.views.helpers import (
    _capability_gate,
    _check_project_accepts_document,
    _ensure_org_membership,
    _validate_project_for_user,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def vendor_bill_contract_view(_request):
    """Return the vendor-bill workflow policy contract for frontend UX guards.

    Read-only endpoint returning the canonical status/transition definitions
    that the frontend uses to render status dropdowns and transition buttons.

    Flow:
        1. Return the policy contract payload.

    URL: ``GET /api/v1/contracts/vendor-bills/``

    Request body: (none)

    Success 200::

        { "data": { "statuses": [...], "transitions": {...}, ... } }
    """
    return Response({"data": get_vendor_bill_policy_contract()})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def org_vendor_bills_view(request):
    """List all vendor bills across all projects for the authenticated user's org.

    Used by the accounting page to show a unified AP ledger.

    Flow:
        1. Resolve org membership.
        2. Query all vendor bills scoped to the org, ordered by date descending.
        3. Return serialized list with eagerly loaded relations.

    URL: ``GET /api/v1/vendor-bills/``

    Request body: (none)

    Success 200::

        { "data": [ { ... }, ... ] }
    """
    membership = _ensure_org_membership(request.user)
    vendor_bills = _prefetch_vendor_bill_qs(
        VendorBill.objects.filter(project__organization_id=membership.organization_id)
        .order_by("-created_at")
    )
    return Response({"data": VendorBillSerializer(vendor_bills, many=True).data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_vendor_bills_view(request, project_id: int):
    """List or create vendor bills for a project.

    ``GET`` returns all vendor bills for the project. ``POST`` creates a new
    vendor bill with line items; validates vendor ownership, date invariants,
    and duplicate detection (vendor + bill_number).

    Flow (POST):
        1. Validate the project belongs to the user's org.
        2. Gate on ``vendor_bills.create`` capability.
        2b. Reject if project is cancelled (terminal guard).
        3. Validate required fields (vendor, bill_number) and line items.
        4. Verify vendor belongs to the user's org.
        5. Validate date invariants (due_date >= issue_date).
        6. Check for duplicate non-void bills (vendor + bill_number).
        7. Create the bill, apply line items, compute totals atomically.
        8. Return the serialized bill with eagerly loaded relations.

    URL: ``GET|POST /api/v1/projects/<project_id>/vendor-bills/``

    Request body (POST)::

        {
            "vendor": "integer (required)",
            "bill_number": "string (required)",
            "issue_date": "YYYY-MM-DD (required)",
            "due_date": "YYYY-MM-DD (required, >= issue_date)",
            "tax_amount": "decimal (optional, default=0)",
            "shipping_amount": "decimal (optional, default=0)",
            "notes": "string (optional)",
            "line_items": [ { "cost_code": "int?", "description": "str?", "amount": "decimal" } ]
        }

    Success 200 (GET)::

        { "data": [ { ... }, ... ] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Validation failure (missing fields, bad dates, empty line items).
        - 403: Missing ``vendor_bills.create`` capability.
        - 404: Project not found or not in user's org.
        - 409: Duplicate non-void bill exists for vendor + bill_number.
    """
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        vendor_bills = _prefetch_vendor_bill_qs(
            VendorBill.objects.filter(project=project).order_by("-created_at")
        )
        return Response({"data": VendorBillSerializer(vendor_bills, many=True).data})

    else:  # POST
        permission_error, _ = _capability_gate(request.user, "vendor_bills", "create")
        if permission_error:
            return Response(permission_error, status=403)

        terminal_error = _check_project_accepts_document(project, "vendor bills")
        if terminal_error:
            return terminal_error

        serializer = VendorBillWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Vendor and bill_number are required
        fields = {}
        if "vendor" not in data or data.get("vendor") is None:
            fields["vendor"] = ["This field is required."]
        if "bill_number" not in data or not data.get("bill_number"):
            fields["bill_number"] = ["This field is required."]
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

        line_items = data.get("line_items", [])
        if not line_items:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "At least one line item is required.",
                        "fields": {"line_items": ["At least one line item is required."]},
                    }
                },
                status=400,
            )

        vendor = Vendor.objects.filter(
            organization_id=project.organization_id, id=data["vendor"],
        ).first()
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

        issue_date = data.get("issue_date")
        due_date = data.get("due_date")
        if issue_date is None:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Issue date is required.",
                        "fields": {"issue_date": ["This field is required."]},
                    }
                },
                status=400,
            )
        due_date = due_date or (issue_date + timedelta(days=30))
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
        blocking_duplicates = [row for row in duplicates if row.status != VendorBill.Status.VOID]
        if blocking_duplicates:
            return Response(
                {
                    "error": {
                        "code": "duplicate_detected",
                        "message": "A non-void vendor bill already exists for this vendor + bill number.",
                        "fields": {},
                    },
                    "data": {
                        "duplicate_candidates": VendorBillSerializer(blocking_duplicates, many=True).data,
                        "allowed_resolutions": ["void_existing_bill"],
                    },
                },
                status=409,
            )

        tax_amount = quantize_money(data.get("tax_amount", 0))
        shipping_amount = quantize_money(data.get("shipping_amount", 0))
        received_date = data.get("received_date")

        with transaction.atomic():
            vendor_bill = VendorBill.objects.create(
                project=project,
                vendor=vendor,
                bill_number=data["bill_number"],
                status=VendorBill.Status.RECEIVED,
                received_date=received_date,
                issue_date=issue_date,
                due_date=due_date,
                notes=data.get("notes", ""),
                created_by=request.user,
            )

            apply_error = _apply_vendor_bill_lines_and_totals(
                vendor_bill, line_items, tax_amount, shipping_amount, request.user,
            )
            if apply_error:
                transaction.set_rollback(True)
                payload, status_code = _vendor_bill_line_apply_error_response(apply_error)
                return Response(payload, status=status_code)

            vendor_bill.refresh_from_db()
            vendor_bill.balance_due = vendor_bill.total
            vendor_bill.save(update_fields=["balance_due", "updated_at"])

        return Response(
            {
                "data": VendorBillSerializer(
                    _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
                ).data,
            },
            status=201,
        )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def vendor_bill_detail_view(request, vendor_bill_id: int):
    """Fetch or patch a vendor bill with lifecycle and line item guardrails.

    ``GET`` returns the hydrated vendor bill. ``PATCH`` applies field updates,
    line item changes, status transitions, or status notes — dispatching to
    the appropriate concern handler.

    Flow (PATCH):
        1. Validate the bill belongs to the user's org.
        2. Gate on ``vendor_bills.edit`` (+ ``vendor_bills.approve`` for approval transitions).
        3. Validate immutability of bill_number.
        4. Validate vendor ownership.
        5. Check for duplicate bills if vendor identity changed.
        6. Dispatch to concern handler: status transition, status note, or document save.

    URL: ``GET|PATCH /api/v1/vendor-bills/<vendor_bill_id>/``

    Request body (PATCH)::

        {
            "status": "string (optional — triggers transition if changed)",
            "status_note": "string (optional — triggers note snapshot)",
            "vendor": "integer (optional)",
            "issue_date": "YYYY-MM-DD (optional)",
            "due_date": "YYYY-MM-DD (optional)",
            "line_items": [ ... ] (optional)
        }

    Success 200::

        { "data": { ... } }

    Errors:
        - 400: Validation or transition failure.
        - 403: Missing capability.
        - 404: Vendor bill not found or not in user's org.
        - 409: Duplicate non-void bill would result from vendor change.
    """
    membership = _ensure_org_membership(request.user)
    try:
        vendor_bill = VendorBill.objects.select_related("project", "vendor").get(
            id=vendor_bill_id,
            project__organization_id=membership.organization_id,
        )
    except VendorBill.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Vendor bill not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        vendor_bill = _prefetch_vendor_bill_qs(
            VendorBill.objects.filter(id=vendor_bill.id)
        ).get()
        return Response({"data": VendorBillSerializer(vendor_bill).data})

    else:  # PATCH
        permission_error, _ = _capability_gate(request.user, "vendor_bills", "edit")
        if permission_error:
            return Response(permission_error, status=403)

        serializer = VendorBillWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Status-transition capability gates
        if "status" in data:
            next_status = data["status"]
            if next_status == VendorBill.Status.APPROVED:
                permission_error, _ = _capability_gate(request.user, "vendor_bills", "approve")
                if permission_error:
                    return Response(permission_error, status=403)

        next_vendor_id = data.get("vendor", vendor_bill.vendor_id)
        next_bill_number = data.get("bill_number", vendor_bill.bill_number)

        if "bill_number" in data and data["bill_number"] != vendor_bill.bill_number:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "bill_number is immutable after creation. Recreate a new bill instead.",
                        "fields": {"bill_number": ["Bill number cannot be edited after creation."]},
                    }
                },
                status=400,
            )

        # Vendor lookup — always required for bills
        next_vendor = Vendor.objects.filter(
            organization_id=membership.organization_id, id=next_vendor_id,
        ).first()
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

        identity_changed = next_vendor.id != vendor_bill.vendor_id
        if identity_changed and next_bill_number:
            duplicates = _find_duplicate_vendor_bills(
                request.user,
                vendor_id=next_vendor.id,
                bill_number=next_bill_number,
                exclude_vendor_bill_id=vendor_bill.id,
            )
            blocking_duplicates = [row for row in duplicates if row.status != VendorBill.Status.VOID]
            if blocking_duplicates:
                return Response(
                    {
                        "error": {
                            "code": "duplicate_detected",
                            "message": "A non-void vendor bill already exists for this vendor + bill number.",
                            "fields": {},
                        },
                        "data": {
                            "duplicate_candidates": VendorBillSerializer(blocking_duplicates, many=True).data,
                            "allowed_resolutions": ["void_existing_bill"],
                        },
                    },
                    status=409,
                )

        # --- Concern dispatch ---
        previous_status = vendor_bill.status
        next_status = data.get("status", previous_status)
        is_actual_transition = "status" in data and previous_status != next_status
        status_note = (data.get("status_note", "") or "").strip()

        if is_actual_transition:
            return _handle_vb_status_transition(
                request, vendor_bill, data,
                previous_status, next_status,
            )
        elif status_note:
            return _handle_vb_status_note(request, vendor_bill, data)
        else:
            return _handle_vb_document_save(request, vendor_bill, data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def vendor_bill_snapshots_view(request, vendor_bill_id: int):
    """Return the immutable status transition history for a vendor bill.

    Flow:
        1. Validate the bill belongs to the user's org.
        2. Query all snapshots ordered by most recent first.
        3. Return serialized snapshot list.

    URL: ``GET /api/v1/vendor-bills/<vendor_bill_id>/snapshots/``

    Request body: (none)

    Success 200::

        { "data": [ { "capture_status": "...", "previous_status": "...", ... }, ... ] }

    Errors:
        - 404: Vendor bill not found or not in user's org.
    """
    membership = _ensure_org_membership(request.user)
    try:
        vendor_bill = VendorBill.objects.get(
            id=vendor_bill_id,
            project__organization_id=membership.organization_id,
        )
    except VendorBill.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Vendor bill not found.", "fields": {}}},
            status=404,
        )

    snapshots = VendorBillSnapshot.objects.filter(vendor_bill=vendor_bill).select_related(
        "acted_by",
    ).order_by("-created_at")
    return Response({"data": VendorBillSnapshotSerializer(snapshots, many=True).data})
