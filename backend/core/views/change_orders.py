from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Budget, ChangeOrder, FinancialAuditEvent, Project
from core.serializers import ChangeOrderSerializer, ChangeOrderWriteSerializer
from core.views.helpers import (
    _get_active_budget_for_project,
    _next_change_order_number,
    _record_financial_audit_event,
    _validate_change_order_status_transition,
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
        rows = ChangeOrder.objects.filter(project=project, requested_by=request.user).order_by(
            "-number"
        )
        return Response({"data": ChangeOrderSerializer(rows, many=True).data})

    serializer = ChangeOrderWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

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

    change_order = ChangeOrder.objects.create(
        project=project,
        number=_next_change_order_number(project=project),
        title=data["title"],
        status=ChangeOrder.Status.DRAFT,
        amount_delta=data["amount_delta"],
        days_delta=data.get("days_delta", 0),
        reason=data.get("reason", ""),
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
        metadata={"number": change_order.number},
    )
    return Response({"data": ChangeOrderSerializer(change_order).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def change_order_detail_view(request, change_order_id: int):
    try:
        change_order = ChangeOrder.objects.select_related("project").get(
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

    serializer = ChangeOrderWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    previous_status = change_order.status
    current_amount_delta = Decimal(str(change_order.amount_delta))
    next_amount_delta = Decimal(str(data.get("amount_delta", current_amount_delta)))
    status_changing = "status" in data
    next_status = data.get("status", previous_status)
    if status_changing and not _validate_change_order_status_transition(
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

    financial_delta = Decimal("0")
    if previous_status != ChangeOrder.Status.APPROVED and next_status == ChangeOrder.Status.APPROVED:
        financial_delta = next_amount_delta
    elif previous_status == ChangeOrder.Status.APPROVED and next_status != ChangeOrder.Status.APPROVED:
        financial_delta = current_amount_delta * Decimal("-1")
    elif (
        previous_status == ChangeOrder.Status.APPROVED
        and next_status == ChangeOrder.Status.APPROVED
        and "amount_delta" in data
    ):
        financial_delta = next_amount_delta - current_amount_delta

    active_budget = None
    if financial_delta != Decimal("0"):
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

    update_fields = ["updated_at"]
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

    with transaction.atomic():
        if len(update_fields) > 1:
            change_order.save(update_fields=update_fields)
        if financial_delta != Decimal("0"):
            Project.objects.filter(
                id=change_order.project_id,
                created_by=request.user,
            ).update(
                contract_value_current=F("contract_value_current") + financial_delta,
            )
            Budget.objects.filter(id=active_budget.id).update(
                approved_change_order_total=F("approved_change_order_total") + financial_delta,
            )
        if previous_status != next_status or financial_delta != Decimal("0"):
            event_note = "Change order status updated."
            if financial_delta != Decimal("0"):
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
                    "number": change_order.number,
                    "financial_delta": str(financial_delta),
                },
            )

    return Response({"data": ChangeOrderSerializer(change_order).data})
