from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Budget, Estimate, EstimateStatusEvent, FinancialAuditEvent
from core.serializers import BudgetSerializer, EstimateSerializer, EstimateStatusEventSerializer, EstimateWriteSerializer
from core.views.helpers import (
    _apply_estimate_lines_and_totals,
    _create_budget_from_estimate,
    _record_financial_audit_event,
    _record_estimate_status_event,
    _validate_estimate_status_transition,
    _validate_project_for_user,
)


def _archive_estimate_family(*, project, user, title, exclude_ids, note):
    normalized_title = (title or "").strip()
    if not normalized_title:
        return

    candidates = (
        Estimate.objects.filter(project=project, created_by=user, title=normalized_title)
        .exclude(id__in=exclude_ids)
        .exclude(status=Estimate.Status.ARCHIVED)
    )
    for candidate in candidates:
        if not _validate_estimate_status_transition(
            current_status=candidate.status,
            next_status=Estimate.Status.ARCHIVED,
        ):
            continue
        previous_status = candidate.status
        candidate.status = Estimate.Status.ARCHIVED
        candidate.save(update_fields=["status", "updated_at"])
        _record_estimate_status_event(
            estimate=candidate,
            from_status=previous_status,
            to_status=Estimate.Status.ARCHIVED,
            note=note,
            changed_by=user,
        )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_estimates_view(request, project_id: int):
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        estimates = (
            Estimate.objects.filter(project=project, created_by=request.user)
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("-version")
        )
        return Response({"data": EstimateSerializer(estimates, many=True).data})

    serializer = EstimateWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
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

    def _line_items_signature(items):
        signature = []
        for item in items:
            signature.append(
                (
                    int(item["cost_code"]),
                    (item.get("description") or "").strip(),
                    str(item.get("quantity", "")),
                    (item.get("unit") or "").strip(),
                    str(item.get("unit_cost", "")),
                    str(item.get("markup_percent", "")),
                )
            )
        return signature

    def _estimate_signature(estimate):
        return [
            (
                item.cost_code_id,
                (item.description or "").strip(),
                str(item.quantity),
                (item.unit or "").strip(),
                str(item.unit_cost),
                str(item.markup_percent),
            )
            for item in estimate.line_items.all()
        ]

    input_signature = _line_items_signature(line_items)
    window_start = timezone.now() - timedelta(seconds=5)
    recent_estimates = (
        Estimate.objects.filter(
            project=project,
            created_by=request.user,
            created_at__gte=window_start,
        )
        .prefetch_related("line_items")
        .order_by("-created_at")
    )
    for candidate in recent_estimates:
        if candidate.title != data.get("title", ""):
            continue
        if candidate.status != data.get("status", Estimate.Status.DRAFT):
            continue
        if candidate.tax_percent != data.get("tax_percent", Decimal("0")):
            continue
        if _estimate_signature(candidate) == input_signature:
            return Response(
                {"data": EstimateSerializer(candidate).data, "meta": {"deduped": True}},
                status=200,
            )

    latest = (
        Estimate.objects.filter(project=project, created_by=request.user)
        .order_by("-version")
        .first()
    )
    next_version = (latest.version + 1) if latest else 1

    estimate = Estimate.objects.create(
        project=project,
        created_by=request.user,
        version=next_version,
        status=data.get("status", Estimate.Status.DRAFT),
        title=data.get("title", ""),
        tax_percent=data.get("tax_percent", Decimal("0")),
    )

    apply_error = _apply_estimate_lines_and_totals(
        estimate=estimate,
        line_items_data=line_items,
        tax_percent=data.get("tax_percent", Decimal("0")),
        user=request.user,
    )
    if apply_error:
        estimate.delete()
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more cost codes are invalid for this user.",
                    "fields": {"cost_code": apply_error["missing_cost_codes"]},
                }
            },
            status=400,
        )

    estimate.refresh_from_db()
    _record_estimate_status_event(
        estimate=estimate,
        from_status=None,
        to_status=estimate.status,
        note="Estimate created.",
        changed_by=request.user,
    )
    _archive_estimate_family(
        project=project,
        user=request.user,
        title=estimate.title,
        exclude_ids=[estimate.id],
        note=f"Archived because estimate #{estimate.id} superseded this version.",
    )
    return Response({"data": EstimateSerializer(estimate).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def estimate_detail_view(request, estimate_id: int):
    try:
        estimate = Estimate.objects.get(id=estimate_id, created_by=request.user)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": EstimateSerializer(estimate).data})

    serializer = EstimateWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    is_locked = estimate.status != Estimate.Status.DRAFT
    mutating_fields = {"title", "tax_percent", "line_items"}
    if is_locked and any(field in data for field in mutating_fields):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Estimate values are locked after being sent.",
                    "fields": {
                        "title": ["Cannot edit non-draft estimate values."],
                        "tax_percent": ["Cannot edit non-draft estimate values."],
                        "line_items": ["Cannot edit non-draft estimate values."],
                    },
                }
            },
            status=400,
        )
    status_note = data.get("status_note", "")
    status_changing = "status" in data
    next_status = data.get("status", estimate.status)

    if status_changing and not _validate_estimate_status_transition(
        current_status=estimate.status,
        next_status=next_status,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid estimate status transition: {estimate.status} -> {next_status}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    previous_status = estimate.status
    update_fields = ["updated_at"]
    if "title" in data:
        estimate.title = data["title"]
        update_fields.append("title")
    if "status" in data:
        estimate.status = data["status"]
        update_fields.append("status")
    if "tax_percent" in data:
        estimate.tax_percent = data["tax_percent"]
        update_fields.append("tax_percent")
    estimate.save(update_fields=update_fields)

    if "line_items" in data:
        line_items = data["line_items"]
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
        apply_error = _apply_estimate_lines_and_totals(
            estimate=estimate,
            line_items_data=line_items,
            tax_percent=data.get("tax_percent", estimate.tax_percent),
            user=request.user,
        )
        if apply_error:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "One or more cost codes are invalid for this user.",
                        "fields": {"cost_code": apply_error["missing_cost_codes"]},
                    }
                },
                status=400,
            )
    elif "tax_percent" in data:
        # Recalculate totals with existing lines when tax is updated.
        existing_lines = [
            {
                "cost_code": line.cost_code_id,
                "description": line.description,
                "quantity": line.quantity,
                "unit": line.unit,
                "unit_cost": line.unit_cost,
                "markup_percent": line.markup_percent,
            }
            for line in estimate.line_items.all()
        ]
        _apply_estimate_lines_and_totals(
            estimate=estimate,
            line_items_data=existing_lines,
            tax_percent=estimate.tax_percent,
            user=request.user,
        )

    if status_changing and previous_status != estimate.status:
        _record_estimate_status_event(
            estimate=estimate,
            from_status=previous_status,
            to_status=estimate.status,
            note=status_note,
            changed_by=request.user,
        )

    estimate.refresh_from_db()
    return Response({"data": EstimateSerializer(estimate).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def estimate_clone_version_view(request, estimate_id: int):
    try:
        estimate = Estimate.objects.prefetch_related("line_items").get(
            id=estimate_id,
            created_by=request.user,
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    latest = (
        Estimate.objects.filter(project=estimate.project, created_by=request.user)
        .order_by("-version")
        .first()
    )
    next_version = (latest.version + 1) if latest else (estimate.version + 1)

    cloned = Estimate.objects.create(
        project=estimate.project,
        created_by=request.user,
        version=next_version,
        status=Estimate.Status.DRAFT,
        title=estimate.title,
        tax_percent=estimate.tax_percent,
    )

    line_items = [
        {
            "cost_code": line.cost_code_id,
            "description": line.description,
            "quantity": line.quantity,
            "unit": line.unit,
            "unit_cost": line.unit_cost,
            "markup_percent": line.markup_percent,
        }
        for line in estimate.line_items.all()
    ]
    if line_items:
        _apply_estimate_lines_and_totals(
            estimate=cloned,
            line_items_data=line_items,
            tax_percent=estimate.tax_percent,
            user=request.user,
        )

    cloned.refresh_from_db()
    _record_estimate_status_event(
        estimate=cloned,
        from_status=None,
        to_status=cloned.status,
        note=f"Cloned from estimate #{estimate.id}.",
        changed_by=request.user,
    )
    _archive_estimate_family(
        project=estimate.project,
        user=request.user,
        title=cloned.title,
        exclude_ids=[cloned.id],
        note=f"Archived because estimate #{cloned.id} superseded this version.",
    )
    return Response(
        {"data": EstimateSerializer(cloned).data, "meta": {"cloned_from": estimate.id}},
        status=201,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def estimate_status_events_view(request, estimate_id: int):
    try:
        estimate = Estimate.objects.get(id=estimate_id, created_by=request.user)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    events = EstimateStatusEvent.objects.filter(estimate=estimate).select_related("changed_by")
    return Response({"data": EstimateStatusEventSerializer(events, many=True).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def estimate_convert_to_budget_view(request, estimate_id: int):
    try:
        estimate = (
            Estimate.objects.select_related("project")
            .prefetch_related("line_items", "line_items__cost_code")
            .get(id=estimate_id, created_by=request.user)
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    if estimate.status != Estimate.Status.APPROVED:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Only approved estimates can be converted to budgets.",
                    "fields": {
                        "status": ["Estimate status must be approved before conversion."]
                    },
                }
            },
            status=400,
        )

    existing = (
        Budget.objects.filter(source_estimate=estimate, created_by=request.user)
        .select_related("source_estimate")
        .prefetch_related("line_items", "line_items__cost_code")
        .first()
    )
    if existing:
        return Response(
            {
                "data": BudgetSerializer(existing).data,
                "meta": {"conversion_status": "already_converted"},
            }
        )

    budget = _create_budget_from_estimate(estimate=estimate, user=request.user)
    budget = (
        Budget.objects.filter(id=budget.id)
        .select_related("source_estimate")
        .prefetch_related("line_items", "line_items__cost_code")
        .get()
    )
    _record_financial_audit_event(
        project=estimate.project,
        event_type=FinancialAuditEvent.EventType.BUDGET_CONVERTED,
        object_type="budget",
        object_id=budget.id,
        to_status=budget.status,
        amount=estimate.grand_total,
        note=f"Budget converted from estimate #{estimate.id}.",
        created_by=request.user,
        metadata={
            "estimate_id": estimate.id,
            "estimate_version": estimate.version,
        },
    )
    return Response(
        {"data": BudgetSerializer(budget).data, "meta": {"conversion_status": "converted"}},
        status=201,
    )
