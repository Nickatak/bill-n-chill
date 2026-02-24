"""Accounts payable vendor-bill endpoints and allocation lifecycle."""

from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    BudgetLine,
    FinancialAuditEvent,
    Vendor,
    VendorBill,
    VendorBillAllocation,
    VendorBillSnapshot,
)
from core.policies import get_vendor_bill_policy_contract
from core.serializers import VendorBillSerializer, VendorBillWriteSerializer
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    _organization_user_ids,
    _record_financial_audit_event,
    _role_gate_error_payload,
    _validate_project_for_user,
)


def _find_duplicate_vendor_bills(
    user,
    *,
    vendor_id: int,
    bill_number: str,
    exclude_vendor_bill_id=None,
):
    """Return same-user vendor bills matching vendor+bill number (case-insensitive)."""
    bill_number_norm = (bill_number or "").strip()
    if not vendor_id or not bill_number_norm:
        return []
    actor_user_ids = _organization_user_ids(user)

    rows = VendorBill.objects.filter(
        created_by_id__in=actor_user_ids,
        vendor_id=vendor_id,
        bill_number__iexact=bill_number_norm,
    )
    if exclude_vendor_bill_id:
        rows = rows.exclude(id=exclude_vendor_bill_id)

    return list(rows.select_related("vendor", "project").order_by("-created_at", "-id"))


def _allocation_total(*, vendor_bill):
    """Return the quantized sum of allocations currently attached to a vendor bill."""
    total = (
        VendorBillAllocation.objects.filter(vendor_bill=vendor_bill).aggregate(sum=Sum("amount"))["sum"]
        or MONEY_ZERO
    )
    return quantize_money(total)


def _validate_allocation_budget_lines(*, project, user, allocations):
    """Resolve allocation budget lines scoped to the same project and owner."""
    budget_line_ids = [entry["budget_line"] for entry in allocations]
    if not budget_line_ids:
        return {}
    actor_user_ids = _organization_user_ids(user)
    rows = BudgetLine.objects.filter(
        id__in=budget_line_ids,
        budget__project=project,
        budget__created_by_id__in=actor_user_ids,
    ).select_related("budget")
    return {row.id: row for row in rows}


def _sync_vendor_bill_allocations(*, vendor_bill, allocations):
    """Replace all allocations for a vendor bill with the provided allocation set."""
    VendorBillAllocation.objects.filter(vendor_bill=vendor_bill).delete()
    if not allocations:
        return
    VendorBillAllocation.objects.bulk_create(
        [
            VendorBillAllocation(
                vendor_bill=vendor_bill,
                budget_line_id=entry["budget_line"],
                amount=entry["amount"],
                note=entry.get("note", ""),
            )
            for entry in allocations
        ]
    )


def _record_vendor_bill_status_snapshot(*, vendor_bill, capture_status, previous_status, acted_by):
    """Persist an immutable vendor-bill snapshot for status transition auditability."""
    allocation_rows = list(
        VendorBillAllocation.objects.filter(vendor_bill=vendor_bill)
        .select_related("budget_line", "budget_line__cost_code")
        .order_by("id")
    )
    snapshot = {
        "vendor_bill": {
            "id": vendor_bill.id,
            "project_id": vendor_bill.project_id,
            "vendor_id": vendor_bill.vendor_id,
            "bill_number": vendor_bill.bill_number,
            "status": vendor_bill.status,
            "issue_date": vendor_bill.issue_date.isoformat() if vendor_bill.issue_date else None,
            "due_date": vendor_bill.due_date.isoformat() if vendor_bill.due_date else None,
            "scheduled_for": vendor_bill.scheduled_for.isoformat() if vendor_bill.scheduled_for else None,
            "total": str(vendor_bill.total),
            "balance_due": str(vendor_bill.balance_due),
            "notes": vendor_bill.notes,
        },
        "decision_context": {
            "capture_status": capture_status,
            "previous_status": previous_status,
        },
        "allocations": [
            {
                "vendor_bill_allocation_id": row.id,
                "budget_line_id": row.budget_line_id,
                "cost_code_id": row.budget_line.cost_code_id,
                "cost_code_code": row.budget_line.cost_code.code,
                "cost_code_name": row.budget_line.cost_code.name,
                "amount": str(row.amount),
                "note": row.note,
            }
            for row in allocation_rows
        ],
    }
    VendorBillSnapshot.objects.create(
        vendor_bill=vendor_bill,
        capture_status=capture_status,
        snapshot_json=snapshot,
        acted_by=acted_by,
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

    - Test anchors:
      - `backend/core/tests/test_vendor_bills.py::VendorBillTests::test_vendor_bill_contract_requires_authentication`
      - `backend/core/tests/test_vendor_bills.py::VendorBillTests::test_vendor_bill_contract_matches_model_transition_policy`
    """
    return Response({"data": get_vendor_bill_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_vendor_bills_view(request, project_id: int):
    """Project vendor-bill collection endpoint: `GET` lists bills, `POST` creates a planned bill.

    Contract:
    - `GET` (user/project-scoped list):
      - `200`: vendor-bill list returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `POST` (requires role `owner|pm|bookkeeping`):
      - `201`: planned vendor bill created and returned.
        - Guarantees:
          - newly created vendor bill status is `planned`. `[APP]`
          - newly created vendor bill satisfies `due_date >= issue_date`. `[DB+APP]`
          - allocation total (if provided) is less than or equal to bill total. `[APP]`
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
          - Standard: `VendorBill` and optional `VendorBillAllocation` rows.
          - Audit: `FinancialAuditEvent`.
        - Edits:
          - Standard: initial computed `balance_due` on the created bill.
          - Audit: none.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "_comment_required": "vendor, bill_number, and total are required",
          "vendor": "integer (required)",
          "bill_number": "string (required)",
          "total": "decimal (required)",
          "issue_date": "YYYY-MM-DD (optional, default=today)",
          "due_date": "YYYY-MM-DD (optional, must be >= issue_date, default=issue_date+30d)",
          "scheduled_for": "YYYY-MM-DD (optional)",
          "notes": "string (optional)",
          "allocations": [
            {
              "budget_line": "integer (required)",
              "amount": "decimal (required)",
              "note": "string (optional)"
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
      - `backend/core/tests/test_vendor_bills.py::test_vendor_bill_create_rolls_back_when_audit_write_fails`
    """
    actor_user_ids = _organization_user_ids(request.user)
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            VendorBill.objects.filter(project=project, created_by_id__in=actor_user_ids)
            .select_related("project", "vendor")
            .prefetch_related("allocations", "allocations__budget_line", "allocations__budget_line__cost_code")
            .order_by("-created_at")
        )
        return Response({"data": VendorBillSerializer(rows, many=True).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
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

    vendor = Vendor.objects.filter(id=data["vendor"], created_by_id__in=actor_user_ids).first()
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

    total = quantize_money(data["total"])
    scheduled_for = data.get("scheduled_for")
    allocations = data.get("allocations", [])
    if allocations:
        line_map = _validate_allocation_budget_lines(
            project=project,
            user=request.user,
            allocations=allocations,
        )
        if len(line_map) != len({entry["budget_line"] for entry in allocations}):
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "One or more allocation budget lines are invalid for this project.",
                        "fields": {"allocations": ["Use budget lines from this project."]},
                    }
                },
                status=400,
            )
        allocation_total = MONEY_ZERO
        for entry in allocations:
            allocation_total = quantize_money(allocation_total + entry["amount"])
        if allocation_total > total:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Allocation total cannot exceed bill total.",
                        "fields": {"allocations": ["Allocated amount exceeds bill total."]},
                    }
                },
                status=400,
            )
    with transaction.atomic():
        vendor_bill = VendorBill.objects.create(
            project=project,
            vendor=vendor,
            bill_number=data["bill_number"],
            status=VendorBill.Status.PLANNED,
            issue_date=issue_date,
            due_date=due_date,
            scheduled_for=scheduled_for,
            total=total,
            balance_due=total,
            notes=data.get("notes", ""),
            created_by=request.user,
        )
        if allocations:
            _sync_vendor_bill_allocations(vendor_bill=vendor_bill, allocations=allocations)
        _record_financial_audit_event(
            project=project,
            event_type=FinancialAuditEvent.EventType.VENDOR_BILL_UPDATED,
            object_type="vendor_bill",
            object_id=vendor_bill.id,
            from_status="",
            to_status=VendorBill.Status.PLANNED,
            amount=vendor_bill.total,
            note="Vendor bill created.",
            created_by=request.user,
            metadata={"bill_number": vendor_bill.bill_number},
        )
    return Response(
        {
            "data": VendorBillSerializer(
                VendorBill.objects.select_related("project", "vendor")
                .prefetch_related("allocations", "allocations__budget_line", "allocations__budget_line__cost_code")
                .get(id=vendor_bill.id)
            ).data,
            "meta": {"duplicate_override_used": False},
        },
        status=201,
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def vendor_bill_detail_view(request, vendor_bill_id: int):
    """Fetch or patch one vendor bill with lifecycle and allocation guardrails.

    Contract:
    - `GET`:
      - `200`: hydrated vendor-bill detail returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: vendor bill not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `PATCH` (requires role `owner|pm|bookkeeping`):
      - `200`: patch applied and updated bill returned.
        - Guarantees:
          - status/date/allocation invariants remain valid. `[DB+APP]`
          - bill `balance_due` remains aligned with status and totals. `[APP]`
      - `400`: validation/transition/allocation failure.
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
          - Standard: replacement `VendorBillAllocation` rows when `allocations` is provided.
          - Audit: `FinancialAuditEvent`; `VendorBillSnapshot` on captured terminal transitions.
        - Edits:
          - Standard: `VendorBill` fields (`vendor`, dates, status, totals, notes, balance).
          - Audit: none.
        - Deletes: existing `VendorBillAllocation` rows when replacing allocations.

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
          "total": "decimal (optional)",
          "notes": "string (optional)",
          "allocations": [
            {
              "budget_line": "integer (required)",
              "amount": "decimal (required)",
              "note": "string (optional)"
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
    actor_user_ids = _organization_user_ids(request.user)
    try:
        vendor_bill = VendorBill.objects.select_related("project", "vendor").get(
            id=vendor_bill_id,
            created_by_id__in=actor_user_ids,
        )
    except VendorBill.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Vendor bill not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        vendor_bill = (
            VendorBill.objects.select_related("project", "vendor")
            .prefetch_related("allocations", "allocations__budget_line", "allocations__budget_line__cost_code")
            .get(id=vendor_bill.id)
        )
        return Response({"data": VendorBillSerializer(vendor_bill).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = VendorBillWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

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

    next_vendor = Vendor.objects.filter(id=next_vendor_id, created_by_id__in=actor_user_ids).first()
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

    previous_status = vendor_bill.status
    next_status = data.get("status", previous_status)
    status_changing = "status" in data
    if status_changing and not VendorBill.is_transition_allowed(
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
    next_scheduled_for = data.get("scheduled_for", vendor_bill.scheduled_for)
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
    if next_status == VendorBill.Status.SCHEDULED and not next_scheduled_for:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "scheduled_for is required when status is scheduled.",
                    "fields": {"scheduled_for": ["Provide a scheduled payment date."]},
                }
            },
            status=400,
        )

    candidate_total = quantize_money(data.get("total", vendor_bill.total))
    candidate_balance_due = (
        MONEY_ZERO if next_status == VendorBill.Status.PAID else candidate_total
    )
    allocations = data.get("allocations")
    if allocations is not None:
        line_map = _validate_allocation_budget_lines(
            project=vendor_bill.project,
            user=request.user,
            allocations=allocations,
        )
        if len(line_map) != len({entry["budget_line"] for entry in allocations}):
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "One or more allocation budget lines are invalid for this project.",
                        "fields": {"allocations": ["Use budget lines from this project."]},
                    }
                },
                status=400,
            )
        allocation_total = MONEY_ZERO
        for entry in allocations:
            allocation_total = quantize_money(allocation_total + entry["amount"])
    else:
        allocation_total = _allocation_total(vendor_bill=vendor_bill)

    if allocation_total > candidate_total:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Allocation total cannot exceed bill total.",
                    "fields": {"allocations": ["Allocated amount exceeds bill total."]},
                }
            },
            status=400,
        )

    if next_status in {VendorBill.Status.APPROVED, VendorBill.Status.SCHEDULED, VendorBill.Status.PAID} and allocation_total != candidate_total:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Approved, scheduled, and paid bills must be fully allocated.",
                    "fields": {"allocations": ["Allocation total must equal bill total."]},
                }
            },
            status=400,
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
    if "scheduled_for" in data:
        vendor_bill.scheduled_for = data["scheduled_for"]
        update_fields.append("scheduled_for")
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

    with transaction.atomic():
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
        if allocations is not None:
            _sync_vendor_bill_allocations(vendor_bill=vendor_bill, allocations=allocations)
        if (
            status_changing
            and previous_status != next_status
            and next_status
            in {
                VendorBill.Status.RECEIVED,
                VendorBill.Status.APPROVED,
                VendorBill.Status.SCHEDULED,
                VendorBill.Status.PAID,
                VendorBill.Status.VOID,
            }
        ):
            _record_vendor_bill_status_snapshot(
                vendor_bill=vendor_bill,
                capture_status=next_status,
                previous_status=previous_status,
                acted_by=request.user,
            )

    vendor_bill = (
        VendorBill.objects.select_related("project", "vendor")
        .prefetch_related("allocations", "allocations__budget_line", "allocations__budget_line__cost_code")
        .get(id=vendor_bill.id)
    )

    return Response(
        {
            "data": VendorBillSerializer(vendor_bill).data,
            "meta": {"duplicate_override_used": False},
        }
    )
