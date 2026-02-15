from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Budget, BudgetLine
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
    return Response({"data": BudgetSerializer(budgets, many=True).data})


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

    return Response({"data": BudgetLineSerializer(line).data})
