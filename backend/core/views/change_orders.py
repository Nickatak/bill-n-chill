from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F
from django.db.models import Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Budget,
    BudgetLine,
    ChangeOrder,
    ChangeOrderLine,
    ChangeOrderSnapshot,
    Estimate,
    FinancialAuditEvent,
    Project,
)
from core.serializers import ChangeOrderSerializer, ChangeOrderWriteSerializer
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    _get_active_budget_for_project,
    _next_change_order_family_key,
    _record_financial_audit_event,
    _role_gate_error_payload,
    _validate_project_for_user,
)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_change_orders_view(request, project_id: int):
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            ChangeOrder.objects.filter(project=project, requested_by=request.user)
            .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
            .order_by("-created_at", "-revision_number")
        )
        return Response({"data": ChangeOrderSerializer(rows, many=True).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = ChangeOrderWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    incoming_line_items = data.get("line_items", [])
    origin_estimate = None

    fields = {}
    if "title" not in data:
        fields["title"] = ["This field is required."]
    if "amount_delta" not in data:
        fields["amount_delta"] = ["This field is required."]
    if fields:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required fields for change order creation.",
                    "fields": fields,
                }
            },
            status=400,
        )

    active_budget = _get_active_budget_for_project(project=project, user=request.user)
    if not active_budget:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Project must have an active budget before creating change orders.",
                    "fields": {"project": ["Create/activate a budget baseline first."]},
                }
            },
            status=400,
        )

    if "origin_estimate" not in data or data["origin_estimate"] is None:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Change orders require an approved origin estimate.",
                    "fields": {"origin_estimate": ["Select an approved estimate from this project."]},
                }
            },
            status=400,
        )
    try:
        origin_estimate = Estimate.objects.get(
            id=data["origin_estimate"],
            project=project,
            created_by=request.user,
        )
    except Estimate.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "origin_estimate is invalid for this project.",
                    "fields": {"origin_estimate": ["Use an estimate from this project."]},
                }
            },
            status=400,
        )
    if origin_estimate.status != Estimate.Status.APPROVED:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Change orders require an approved origin estimate.",
                    "fields": {"origin_estimate": ["Only approved estimates can be used as CO origin."]},
                }
            },
            status=400,
        )

    line_map = {}
    line_total_delta = MONEY_ZERO
    if incoming_line_items:
        line_map, line_total_delta, line_error = _validate_change_order_lines(
            project=project,
            line_items=incoming_line_items,
        )
        if line_error:
            return line_error
        if line_total_delta != Decimal(str(data["amount_delta"])):
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Line-item total must match change-order amount delta.",
                        "fields": {"line_items": ["Sum of line item amount_delta must equal amount_delta."]},
                    }
                },
                status=400,
            )

    try:
        with transaction.atomic():
            change_order = ChangeOrder.objects.create(
                project=project,
                family_key=_next_change_order_family_key(project=project),
                revision_number=1,
                title=data["title"],
                status=ChangeOrder.Status.DRAFT,
                amount_delta=data["amount_delta"],
                days_delta=data.get("days_delta", 0),
                reason=data.get("reason", ""),
                origin_estimate=origin_estimate,
                requested_by=request.user,
            )
            _record_financial_audit_event(
                project=project,
                event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
                object_type="change_order",
                object_id=change_order.id,
                from_status="",
                to_status=ChangeOrder.Status.DRAFT,
                amount=change_order.amount_delta,
                note="Change order created.",
                created_by=request.user,
                metadata={"family_key": change_order.family_key},
            )
            if incoming_line_items:
                _sync_change_order_lines(
                    change_order=change_order,
                    line_items=incoming_line_items,
                    line_map=line_map,
                )
    except ValidationError as exc:
        return _model_validation_error_response(
            exc=exc,
            message="Change-order line items are invalid for this project/budget context.",
        )
    created = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(created).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def change_order_detail_view(request, change_order_id: int):
    try:
        change_order = ChangeOrder.objects.select_related("project").prefetch_related(
                "line_items", "line_items__budget_line", "line_items__budget_line__cost_code"
        ).get(
            id=change_order_id,
            requested_by=request.user,
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": ChangeOrderSerializer(change_order).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = ChangeOrderWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    incoming_line_items = data.get("line_items", None)

    latest_revision_exists = ChangeOrder.objects.filter(
        project=change_order.project,
        family_key=change_order.family_key,
        revision_number__gt=change_order.revision_number,
    ).exists()
    if latest_revision_exists:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Only the latest change-order revision can be edited.",
                    "fields": {"change_order": ["Create or edit the latest revision for this family."]},
                }
            },
            status=400,
        )

    previous_status = change_order.status
    current_amount_delta = quantize_money(change_order.amount_delta)
    next_amount_delta = quantize_money(data.get("amount_delta", current_amount_delta))
    status_changing = "status" in data
    next_status = data.get("status", previous_status)
    if status_changing and not ChangeOrder.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid change order status transition: {previous_status} -> {next_status}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    financial_delta = MONEY_ZERO
    if previous_status != ChangeOrder.Status.APPROVED and next_status == ChangeOrder.Status.APPROVED:
        financial_delta = next_amount_delta
    elif previous_status == ChangeOrder.Status.APPROVED and next_status != ChangeOrder.Status.APPROVED:
        financial_delta = quantize_money(current_amount_delta * Decimal("-1"))
    elif (
        previous_status == ChangeOrder.Status.APPROVED
        and next_status == ChangeOrder.Status.APPROVED
        and "amount_delta" in data
    ):
        financial_delta = next_amount_delta - current_amount_delta

    active_budget = None
    if financial_delta != MONEY_ZERO:
        active_budget = _get_active_budget_for_project(
            project=change_order.project,
            user=request.user,
        )
        if not active_budget:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Project must have an active budget for change-order propagation.",
                        "fields": {"project": ["Create/activate a budget baseline first."]},
                    }
                },
                status=400,
            )

    if incoming_line_items is not None:
        line_map, line_total_delta, line_error = _validate_change_order_lines(
            project=change_order.project,
            line_items=incoming_line_items,
        )
        if line_error:
            return line_error
        if line_total_delta != next_amount_delta:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Line-item total must match change-order amount delta.",
                        "fields": {"line_items": ["Sum of line item amount_delta must equal amount_delta."]},
                    }
                },
                status=400,
            )
    else:
        existing_line_total = change_order.line_items.aggregate(total=Sum("amount_delta")).get("total") or Decimal(
            "0.00"
        )
        if "amount_delta" in data and existing_line_total != Decimal("0.00") and existing_line_total != next_amount_delta:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Existing line items no longer match amount delta.",
                        "fields": {
                            "amount_delta": [
                                "Update line_items with amount_delta so total remains consistent.",
                            ]
                        },
                    }
                },
                status=400,
            )

    update_fields = ["updated_at"]
    if "origin_estimate" in data:
        if change_order.origin_estimate_id and data["origin_estimate"] != change_order.origin_estimate_id:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "origin_estimate cannot be changed after being set.",
                        "fields": {"origin_estimate": ["Create a new revision to change estimate linkage."]},
                    }
                },
                status=400,
            )
        if data["origin_estimate"] is None:
            if change_order.origin_estimate_id is not None:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "origin_estimate cannot be cleared once set.",
                            "fields": {"origin_estimate": ["Create a new revision to remove estimate linkage."]},
                        }
                    },
                    status=400,
                )
        elif change_order.origin_estimate_id is None:
            try:
                origin_estimate = Estimate.objects.get(
                    id=data["origin_estimate"],
                    project=change_order.project,
                    created_by=request.user,
                )
            except Estimate.DoesNotExist:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "origin_estimate is invalid for this project.",
                            "fields": {"origin_estimate": ["Use an estimate from this project."]},
                        }
                    },
                    status=400,
                )
            if origin_estimate.status != Estimate.Status.APPROVED:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Change orders require an approved origin estimate.",
                            "fields": {"origin_estimate": ["Only approved estimates can be used as CO origin."]},
                        }
                    },
                    status=400,
                )
            change_order.origin_estimate = origin_estimate
            update_fields.append("origin_estimate")
    if "title" in data:
        change_order.title = data["title"]
        update_fields.append("title")
    if "amount_delta" in data:
        change_order.amount_delta = data["amount_delta"]
        update_fields.append("amount_delta")
    if "days_delta" in data:
        change_order.days_delta = data["days_delta"]
        update_fields.append("days_delta")
    if "reason" in data:
        change_order.reason = data["reason"]
        update_fields.append("reason")
    if "status" in data:
        change_order.status = data["status"]
        update_fields.append("status")

    if status_changing and previous_status != next_status and next_status == ChangeOrder.Status.APPROVED:
        change_order.approved_by = request.user
        change_order.approved_at = timezone.now()
        update_fields.extend(["approved_by", "approved_at"])

    try:
        with transaction.atomic():
            if len(update_fields) > 1:
                change_order.save(update_fields=update_fields)
            if incoming_line_items is not None:
                _sync_change_order_lines(
                    change_order=change_order,
                    line_items=incoming_line_items,
                    line_map=line_map,
                )
            if financial_delta != MONEY_ZERO:
                Project.objects.filter(
                    id=change_order.project_id,
                    created_by=request.user,
                ).update(
                    contract_value_current=F("contract_value_current") + financial_delta,
                )
                Budget.objects.filter(id=active_budget.id).update(
                    approved_change_order_total=F("approved_change_order_total") + financial_delta,
                )
            if previous_status != next_status or financial_delta != MONEY_ZERO:
                event_note = "Change order status updated."
                if financial_delta != MONEY_ZERO:
                    event_note = f"{event_note} Financial delta applied: {financial_delta}."
                _record_financial_audit_event(
                    project=change_order.project,
                    event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
                    object_type="change_order",
                    object_id=change_order.id,
                    from_status=previous_status,
                    to_status=next_status,
                    amount=next_amount_delta,
                    note=event_note,
                    created_by=request.user,
                    metadata={
                        "family_key": change_order.family_key,
                        "financial_delta": str(financial_delta),
                    },
                )
            if (
                status_changing
                and previous_status != next_status
                and next_status in {
                    ChangeOrder.Status.APPROVED,
                    ChangeOrder.Status.REJECTED,
                    ChangeOrder.Status.VOID,
                }
            ):
                _record_change_order_decision_snapshot(
                    change_order=change_order,
                    decision_status=next_status,
                    previous_status=previous_status,
                    applied_financial_delta=financial_delta,
                    decided_by=request.user,
                )
    except ValidationError as exc:
        return _model_validation_error_response(
            exc=exc,
            message="Change-order line items are invalid for this project/budget context.",
        )
    refreshed = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(refreshed).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_order_clone_revision_view(request, change_order_id: int):
    try:
        change_order = (
            ChangeOrder.objects.select_related("project", "origin_estimate")
            .prefetch_related("line_items")
            .get(id=change_order_id, requested_by=request.user)
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm"})
    if permission_error:
        return Response(permission_error, status=403)

    latest = (
        ChangeOrder.objects.filter(
            project=change_order.project,
            family_key=change_order.family_key,
            requested_by=request.user,
        )
        .order_by("-revision_number")
        .first()
    )
    if latest and latest.id != change_order.id:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Revisions can only be cloned from the latest family version.",
                    "fields": {"change_order": ["Select the latest revision before cloning."]},
                }
            },
            status=400,
        )

    next_revision = (latest.revision_number + 1) if latest else (change_order.revision_number + 1)
    with transaction.atomic():
        clone = ChangeOrder.objects.create(
            project=change_order.project,
            family_key=change_order.family_key,
            revision_number=next_revision,
            title=change_order.title,
            status=ChangeOrder.Status.DRAFT,
            amount_delta=change_order.amount_delta,
            days_delta=change_order.days_delta,
            reason=change_order.reason,
            origin_estimate=change_order.origin_estimate,
            previous_change_order=change_order,
            requested_by=request.user,
        )
        _sync_change_order_lines(
            change_order=clone,
            line_items=[
                {
                    "budget_line": line.budget_line_id,
                    "description": line.description,
                    "amount_delta": str(line.amount_delta),
                    "days_delta": line.days_delta,
                }
                for line in change_order.line_items.all()
            ],
            line_map={line.budget_line_id: line.budget_line for line in change_order.line_items.all()},
        )
        _record_financial_audit_event(
            project=clone.project,
            event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
            object_type="change_order",
            object_id=clone.id,
            from_status="",
            to_status=clone.status,
            amount=clone.amount_delta,
            note=f"Change order revision created from CO-{change_order.family_key} v{change_order.revision_number}.",
            created_by=request.user,
            metadata={
                "family_key": clone.family_key,
                "revision_number": clone.revision_number,
                "previous_change_order_id": change_order.id,
            },
        )

    created = (
        ChangeOrder.objects.filter(id=clone.id)
        .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(created).data}, status=201)


def _validate_change_order_lines(*, project, line_items):
    if not line_items:
        return {}, MONEY_ZERO, None

    budget_line_ids = [int(row["budget_line"]) for row in line_items]
    unique_budget_line_ids = set(budget_line_ids)
    if len(unique_budget_line_ids) != len(budget_line_ids):
        return (
            {},
            MONEY_ZERO,
            Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Duplicate budget lines are not allowed within a change order.",
                        "fields": {"line_items": ["Use each budget_line at most once."]},
                    }
                },
                status=400,
            ),
        )

    line_map = {
        row.id: row
        for row in BudgetLine.objects.select_related("budget", "cost_code").filter(
            id__in=unique_budget_line_ids,
        )
    }
    if len(line_map) != len(unique_budget_line_ids):
        return (
            {},
            MONEY_ZERO,
            Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "One or more line_items budget_line values are invalid.",
                        "fields": {"line_items": ["Use valid budget_line ids."]},
                    }
                },
                status=400,
            ),
        )

    total = MONEY_ZERO
    for row in line_items:
        total = quantize_money(total + Decimal(str(row["amount_delta"])))
    return line_map, total, None


def _sync_change_order_lines(*, change_order, line_items, line_map):
    ChangeOrderLine.objects.filter(change_order=change_order).delete()
    for row in line_items:
        ChangeOrderLine.objects.create(
            change_order=change_order,
            budget_line=line_map[int(row["budget_line"])],
            description=row.get("description", ""),
            amount_delta=quantize_money(row["amount_delta"]),
            days_delta=row.get("days_delta", 0),
        )


def _record_change_order_decision_snapshot(
    *,
    change_order,
    decision_status,
    previous_status,
    applied_financial_delta,
    decided_by,
):
    line_rows = list(
        ChangeOrderLine.objects.filter(change_order=change_order)
        .select_related("budget_line", "budget_line__cost_code")
        .order_by("id")
    )
    origin_estimate_version = None
    if change_order.origin_estimate_id is not None:
        origin_estimate_version = (
            Estimate.objects.filter(id=change_order.origin_estimate_id).values_list("version", flat=True).first()
        )

    snapshot = {
        "change_order": {
            "id": change_order.id,
            "project_id": change_order.project_id,
            "family_key": change_order.family_key,
            "revision_number": change_order.revision_number,
            "title": change_order.title,
            "status": change_order.status,
            "amount_delta": str(change_order.amount_delta),
            "days_delta": change_order.days_delta,
            "reason": change_order.reason,
            "origin_estimate_id": change_order.origin_estimate_id,
            "origin_estimate_version": origin_estimate_version,
            "previous_change_order_id": change_order.previous_change_order_id,
            "approved_by_id": change_order.approved_by_id,
            "approved_at": change_order.approved_at.isoformat() if change_order.approved_at else None,
        },
        "decision_context": {
            "decision_status": decision_status,
            "previous_status": previous_status,
            "applied_financial_delta": str(applied_financial_delta),
        },
        "line_items": [
            {
                "change_order_line_id": row.id,
                "budget_line_id": row.budget_line_id,
                "cost_code_id": row.budget_line.cost_code_id,
                "cost_code_code": row.budget_line.cost_code.code,
                "cost_code_name": row.budget_line.cost_code.name,
                "description": row.description,
                "amount_delta": str(row.amount_delta),
                "days_delta": row.days_delta,
            }
            for row in line_rows
        ],
    }
    ChangeOrderSnapshot.objects.create(
        change_order=change_order,
        decision_status=decision_status,
        snapshot_json=snapshot,
        decided_by=decided_by,
    )


def _model_validation_error_response(*, exc: ValidationError, message: str):
    fields = {}
    if hasattr(exc, "message_dict"):
        fields = exc.message_dict
    else:
        fields = {"non_field_errors": exc.messages}
    return Response(
        {
            "error": {
                "code": "validation_error",
                "message": message,
                "fields": fields,
            }
        },
        status=400,
    )
