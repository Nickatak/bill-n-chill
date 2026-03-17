"""Accounts payable vendor-bill endpoints and line item lifecycle."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Vendor,
    VendorBill,
)
from core.policies import get_vendor_bill_policy_contract
from core.serializers import VendorBillSerializer, VendorBillWriteSerializer
from core.utils.money import quantize_money
from core.views.accounts_payable.vendor_bills_helpers import (
    DATE_REQUIRED_STATUSES,
    _apply_vendor_bill_lines_and_totals,
    _find_duplicate_vendor_bills,
    _handle_vb_document_save,
    _handle_vb_status_transition,
    _prefetch_vendor_bill_qs,
    _vendor_bill_line_apply_error_response,
)
from core.views.helpers import (
    _capability_gate,
    _ensure_membership,
    _validate_project_for_user,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def vendor_bill_contract_view(_request):
    """Return canonical vendor-bill workflow policy for frontend UX guards.

    Contract:
    - `GET`:
      - `200`: vendor-bill policy contract returned.
        - Guarantees:
          - statuses/transitions mirror backend model-level transition guards. `[APP]`
          - no object mutations. `[APP]`
      - `401`: authentication missing/invalid.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller must be authenticated (`IsAuthenticated`).

    - Object mutations:
      - `GET`: none.

    - Idempotency and retry semantics:
      - `GET` is idempotent and read-only.
    """
    return Response({"data": get_vendor_bill_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_vendor_bills_view(request, project_id: int):
    """Project vendor-bill collection endpoint: `GET` lists bills, `POST` creates a bill with line items.

    Contract:
    - `GET` (user/project-scoped list):
      - `200`: vendor-bill list returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `POST` (requires role `owner|pm|bookkeeping`):
      - `201`: vendor bill created with line items and returned.
        - Guarantees:
          - newly created vendor bill status is `received`. `[APP]`
          - newly created vendor bill satisfies `due_date >= issue_date`. `[DB+APP]`
          - totals computed from line item amounts + tax_amount + shipping_amount. `[APP]`
      - `400`: validation or business-rule failure.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for create.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`
      - `409`: duplicate non-void vendor bill exists for `vendor + bill_number`.
        - Guarantees: no object mutations. `[APP]`

    - Incoming payload (`POST`) shape:
      - JSON map:
        {
          "vendor": "integer (required)",
          "bill_number": "string (required)",
          "issue_date": "YYYY-MM-DD (required)",
          "due_date": "YYYY-MM-DD (required, must be >= issue_date)",
          "tax_amount": "decimal (optional, default=0)",
          "shipping_amount": "decimal (optional, default=0)",
          "notes": "string (optional)",
          "line_items": [
            {
              "cost_code": "integer (optional)",
              "description": "string (optional)",
              "amount": "decimal (required)"
            }
          ]
        }
    """
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            VendorBill.objects.filter(project=project)
            .select_related("project", "vendor")
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("-created_at")
        )
        return Response({"data": VendorBillSerializer(rows, many=True).data})

    permission_error, _ = _capability_gate(request.user, "vendor_bills", "create")
    if permission_error:
        return Response(permission_error, status=403)

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

    membership = _ensure_membership(request.user)
    vendor = Vendor.objects.filter(
        organization_id=membership.organization_id, id=data["vendor"],
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
            "meta": {"duplicate_override_used": False},
        },
        status=201,
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def vendor_bill_detail_view(request, vendor_bill_id: int):
    """Fetch or patch one vendor bill with lifecycle and line item guardrails.

    Contract:
    - `GET`:
      - `200`: hydrated vendor-bill detail returned.
      - `404`: vendor bill not found for this user.
    - `PATCH` (requires role `owner|pm|bookkeeping`):
      - `200`: patch applied and updated bill returned.
        - Guarantees:
          - status/date invariants remain valid. `[DB+APP]`
          - totals recomputed when line_items provided. `[APP]`
      - `400`: validation/transition failure.
      - `403`: role gate denied for patch.
      - `404`: vendor bill not found for this user.
      - `409`: duplicate non-void vendor bill would result from identity change.
    """
    membership = _ensure_membership(request.user)
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

    permission_error, _ = _capability_gate(request.user, "vendor_bills", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = VendorBillWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    # Status-transition capability gates
    if "status" in data:
        _next = data["status"]
        if _next == VendorBill.Status.APPROVED:
            _err, _ = _capability_gate(request.user, "vendor_bills", "approve")
            if _err:
                return Response(_err, status=403)

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

    if is_actual_transition:
        return _handle_vb_status_transition(
            request, vendor_bill, data,
            previous_status, next_status,
        )
    return _handle_vb_document_save(request, vendor_bill, data)
