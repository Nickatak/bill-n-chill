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
    RECEIVED_PLUS_STATUSES,
    _apply_vendor_bill_lines_and_totals,
    _find_duplicate_vendor_bills,
    _handle_vb_document_save,
    _handle_vb_status_transition,
    _prefetch_vendor_bill_qs,
    _vendor_bill_line_apply_error_response,
    _vendor_scope_filter,
)
from core.views.helpers import (
    _capability_gate,
    _ensure_membership,
    _validate_project_for_user,
)

CREATE_ALLOWED_STATUSES = {
    VendorBill.Status.PLANNED,
    VendorBill.Status.RECEIVED,
}


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

    - Test anchors:
      - `backend/core/tests/test_vendor_bills.py::VendorBillTests::test_vendor_bill_contract_requires_authentication`
      - `backend/core/tests/test_vendor_bills.py::VendorBillTests::test_vendor_bill_contract_matches_model_transition_policy`
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
          - newly created vendor bill status is `planned` or `received`. `[APP]`
          - newly created vendor bill satisfies `due_date >= issue_date`. `[DB+APP]`
          - totals computed from line items + tax_amount + shipping_amount. `[APP]`
      - `400`: validation or business-rule failure.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for create.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`
      - `409`: duplicate non-void vendor bill exists for `vendor + bill_number`.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - project must resolve through user scope (`_validate_project_for_user`).
      - caller role must be `owner|pm|bookkeeping`.

    - Object mutations:
      - `GET`: none.
      - `POST`:
        - Creates:
          - Standard: `VendorBill` and `VendorBillLine` rows.
        - Edits:
          - Standard: computed subtotal/tax_amount/shipping_amount/total/balance_due on the created bill.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "_comment_required": "vendor, bill_number, status, and line_items are required",
          "vendor": "integer (required)",
          "bill_number": "string (required)",
          "status": "planned|received (required)",
          "issue_date": "YYYY-MM-DD (required when status=received; optional for planned, default=today)",
          "due_date": "YYYY-MM-DD (required when status=received; optional for planned, must be >= issue_date, default=issue_date+30d)",
          "tax_amount": "decimal (optional, default=0)",
          "shipping_amount": "decimal (optional, default=0)",
          "scheduled_for": "YYYY-MM-DD (optional)",
          "notes": "string (optional)",
          "line_items": [
            {
              "cost_code": "integer (optional)",
              "description": "string (optional)",
              "quantity": "decimal (optional, default=1)",
              "unit": "string (optional, default='ea')",
              "unit_price": "decimal (required)"
            }
          ]
        }

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.
      - `POST` is not idempotent.
      - duplicate-protected retries may return `409` until conflicting row is voided.

    - Test anchors:
      - `backend/core/tests/test_vendor_bills.py::test_vendor_bill_create_and_project_list`
      - `backend/core/tests/test_vendor_bills.py::test_vendor_bill_duplicate_requires_existing_match_to_be_void`
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

    fields = {}
    if "vendor" not in data:
        fields["vendor"] = ["This field is required."]
    if "bill_number" not in data:
        fields["bill_number"] = ["This field is required."]
    if "status" not in data:
        fields["status"] = ["This field is required."]
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

    requested_status = data["status"]
    if requested_status not in CREATE_ALLOWED_STATUSES:
        allowed = ", ".join(sorted(CREATE_ALLOWED_STATUSES))
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"status must be one of: {allowed}.",
                    "fields": {"status": [f"Choose one of: {allowed}."]},
                }
            },
            status=400,
        )

    vendor = Vendor.objects.filter(_vendor_scope_filter(request.user), id=data["vendor"]).first()
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
    required_status_date_fields = {}
    if requested_status in RECEIVED_PLUS_STATUSES:
        if issue_date is None:
            required_status_date_fields["issue_date"] = [
                "Issue/received date is required for received-or-later bills."
            ]
        if due_date is None:
            required_status_date_fields["due_date"] = ["Due date is required for received-or-later bills."]
    if required_status_date_fields:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required date fields for the selected initial status.",
                    "fields": required_status_date_fields,
                }
            },
            status=400,
        )

    issue_date = issue_date or timezone.localdate()
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
    scheduled_for = data.get("scheduled_for")

    with transaction.atomic():
        vendor_bill = VendorBill.objects.create(
            project=project,
            vendor=vendor,
            bill_number=data["bill_number"],
            status=requested_status,
            received_date=received_date,
            issue_date=issue_date,
            due_date=due_date,
            scheduled_for=scheduled_for,
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
        - Guarantees: no object mutations. `[APP]`
      - `404`: vendor bill not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `PATCH` (requires role `owner|pm|bookkeeping`):
      - `200`: patch applied and updated bill returned.
        - Guarantees:
          - status/date invariants remain valid. `[DB+APP]`
          - bill `balance_due` remains aligned with status and totals. `[APP]`
          - totals recomputed when line_items provided. `[APP]`
      - `400`: validation/transition failure.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for patch.
        - Guarantees: no object mutations. `[APP]`
      - `404`: vendor bill not found for this user.
        - Guarantees: no object mutations. `[APP]`
      - `409`: duplicate non-void vendor bill would result from identity change.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - vendor bill must belong to requesting user.
      - caller role must be `owner|pm|bookkeeping`.

    - Object mutations:
      - `GET`: none.
      - `PATCH`:
        - Creates:
          - Standard: replacement `VendorBillLine` rows when `line_items` is provided.
          - Audit: `VendorBillSnapshot` on captured terminal transitions.
        - Edits:
          - Standard: `VendorBill` fields (`vendor`, dates, status, totals, notes, balance).
        - Deletes: existing `VendorBillLine` rows when replacing line items.

    - Incoming payload (`PATCH`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "vendor": "integer (optional)",
          "_comment_bill_number_immutable": "bill_number cannot be changed after creation",
          "status": "planned|received|approved|scheduled|paid|void (optional)",
          "issue_date": "YYYY-MM-DD (optional)",
          "due_date": "YYYY-MM-DD (optional, must be >= issue_date)",
          "scheduled_for": "YYYY-MM-DD (required when status=scheduled)",
          "tax_amount": "decimal (optional)",
          "shipping_amount": "decimal (optional)",
          "notes": "string (optional)",
          "line_items": [
            {
              "cost_code": "integer (optional)",
              "description": "string (optional)",
              "quantity": "decimal (optional, default=1)",
              "unit": "string (optional, default='ea')",
              "unit_price": "decimal (required)"
            }
          ]
        }

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.
      - `PATCH` is conditionally idempotent when payload values equal persisted values.
      - failed `PATCH` retries do not persist partial writes.

    - Test anchors:
      - `backend/core/tests/test_vendor_bills.py::test_vendor_bill_status_transition_and_balance_due`
      - `backend/core/tests/test_vendor_bills.py::test_vendor_bill_patch_rejects_bill_number_change`
      - `backend/core/tests/test_vendor_bills.py::test_vendor_bill_status_transitions_create_snapshots_for_all_captured_statuses`
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
        if _next in {VendorBill.Status.APPROVED, VendorBill.Status.SCHEDULED}:
            _err, _ = _capability_gate(request.user, "vendor_bills", "approve")
            if _err:
                return Response(_err, status=403)
        elif _next == VendorBill.Status.PAID:
            _err, _ = _capability_gate(request.user, "vendor_bills", "pay")
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

    next_vendor = Vendor.objects.filter(_vendor_scope_filter(request.user), id=next_vendor_id).first()
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
    if identity_changed:
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
