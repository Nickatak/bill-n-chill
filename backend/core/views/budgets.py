from decimal import Decimal

from django.db.models import Sum
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Budget, BudgetLine, ChangeOrder, ChangeOrderLine, VendorBill, VendorBillAllocation
from core.serializers import BudgetLineSerializer, BudgetLineUpdateSerializer, BudgetSerializer
from core.views.helpers import _validate_project_for_user


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_budgets_view(request, project_id: int):
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    budgets = (
        Budget.objects.filter(project=project, created_by=request.user)
        .select_related("source_estimate")
        .prefetch_related("line_items", "line_items__cost_code")
        .order_by("-created_at")
    )
    line_ids = []
    for budget in budgets:
        line_ids.extend([line.id for line in budget.line_items.all()])

    line_actual_spend_map = {}
    line_approved_co_delta_map = {}
    if line_ids:
        spend_rows = (
            VendorBillAllocation.objects.filter(
                budget_line_id__in=line_ids,
                vendor_bill__project=project,
                vendor_bill__created_by=request.user,
                vendor_bill__status=VendorBill.Status.PAID,
            )
            .values("budget_line_id")
            .annotate(total=Sum("amount"))
        )
        line_actual_spend_map = {
            row["budget_line_id"]: row["total"] or Decimal("0") for row in spend_rows
        }
        approved_co_rows = (
            ChangeOrderLine.objects.filter(
                budget_line_id__in=line_ids,
                change_order__project=project,
                change_order__requested_by=request.user,
                change_order__status=ChangeOrder.Status.APPROVED,
            )
            .values("budget_line_id")
            .annotate(total=Sum("amount_delta"))
        )
        line_approved_co_delta_map = {
            row["budget_line_id"]: row["total"] or Decimal("0") for row in approved_co_rows
        }

    serializer = BudgetSerializer(
        budgets,
        many=True,
        context={
            "line_actual_spend_map": line_actual_spend_map,
            "line_approved_co_delta_map": line_approved_co_delta_map,
        },
    )
    return Response({"data": serializer.data})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def budget_line_detail_view(request, budget_id: int, line_id: int):
    try:
        budget = Budget.objects.get(id=budget_id, created_by=request.user)
    except Budget.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Budget not found.", "fields": {}}},
            status=404,
        )

    if budget.status != Budget.Status.ACTIVE:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Only active budgets can be edited.",
                    "fields": {"status": ["Budget status must be active."]},
                }
            },
            status=400,
        )

    try:
        line = BudgetLine.objects.select_related("cost_code").get(id=line_id, budget=budget)
    except BudgetLine.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Budget line not found.", "fields": {}}},
            status=404,
        )

    serializer = BudgetLineUpdateSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    update_fields = ["updated_at"]
    if "description" in data:
        line.description = data["description"]
        update_fields.append("description")
    if "budget_amount" in data:
        line.budget_amount = data["budget_amount"]
        update_fields.append("budget_amount")
    if len(update_fields) > 1:
        line.save(update_fields=update_fields)

    spend_total = (
        VendorBillAllocation.objects.filter(
            budget_line_id=line.id,
            vendor_bill__project=budget.project,
            vendor_bill__created_by=request.user,
            vendor_bill__status=VendorBill.Status.PAID,
        ).aggregate(total=Sum("amount"))["total"]
        or Decimal("0")
    )
    serializer = BudgetLineSerializer(
        line,
        context={
            "line_actual_spend_map": {line.id: spend_total},
            "line_approved_co_delta_map": {
                line.id: (
                    ChangeOrderLine.objects.filter(
                        budget_line_id=line.id,
                        change_order__project=budget.project,
                        change_order__requested_by=request.user,
                        change_order__status=ChangeOrder.Status.APPROVED,
                    ).aggregate(total=Sum("amount_delta"))["total"]
                    or Decimal("0")
                )
            },
        },
    )
    return Response({"data": serializer.data})
