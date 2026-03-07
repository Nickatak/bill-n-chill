"""Project CRUD and detail endpoints."""

import csv
from datetime import datetime, timezone
from decimal import Decimal
from io import StringIO

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    FinancialAuditEvent,
    Project,
)
from core.serializers import (
    FinancialAuditEventSerializer,
    ProjectFinancialSummarySerializer,
    ProjectProfileSerializer,
    ProjectSerializer,
)
from core.views.helpers import _capability_gate, _ensure_membership, _organization_user_ids
from core.views.shared_operations.projects_helpers import (
    _build_project_financial_summary_data,
    _project_accepted_contract_totals_map,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def projects_list_view(request):
    """List projects visible to the authenticated owner context."""
    membership = _ensure_membership(request.user)
    actor_user_ids = _organization_user_ids(request.user)
    rows = list(
        Project.objects.filter(organization_id=membership.organization_id).select_related("customer")
    )
    accepted_totals_by_project = _project_accepted_contract_totals_map(
        project_ids=[row.id for row in rows],
        actor_user_ids=actor_user_ids,
    )
    serialized_rows = ProjectSerializer(rows, many=True).data
    for row in serialized_rows:
        project_id = int(row.get("id"))
        accepted_total = accepted_totals_by_project.get(project_id, Decimal("0"))
        row["accepted_contract_total"] = f"{accepted_total:.2f}"
    return Response({"data": serialized_rows})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def project_detail_view(request, project_id: int):
    """Fetch or patch a project profile with terminal-state and transition protections."""
    membership = _ensure_membership(request.user)
    actor_user_ids = _organization_user_ids(request.user)
    try:
        project = Project.objects.select_related("customer").get(
            id=project_id,
            organization_id=membership.organization_id,
        )
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        accepted_total = _project_accepted_contract_totals_map(
            project_ids=[project.id],
            actor_user_ids=actor_user_ids,
        ).get(project.id, Decimal("0"))
        payload = ProjectProfileSerializer(project).data
        payload["accepted_contract_total"] = f"{accepted_total:.2f}"
        return Response({"data": payload})

    permission_error, _ = _capability_gate(request.user, "projects", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    if project.status in {Project.Status.COMPLETED, Project.Status.CANCELLED}:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Project is in a terminal state and can no longer be edited.",
                    "fields": {"status": ["Terminal projects are immutable."]},
                }
            },
            status=400,
        )

    immutable_contract_fields = {
        "contract_value_original": "Original contract value is immutable after project creation.",
        "contract_value_current": "Current contract value is system-derived and cannot be edited directly.",
    }
    blocked_field = next((field for field in immutable_contract_fields if field in request.data), None)
    if blocked_field:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": immutable_contract_fields[blocked_field],
                    "fields": {
                        blocked_field: [
                            "This field cannot be changed after project creation."
                        ]
                    },
                }
            },
            status=400,
        )

    if "status" in request.data:
        next_status = request.data.get("status")
        current_status = project.status
        if next_status != current_status:
            if not Project.is_transition_allowed(current_status, next_status):
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": f"Invalid project status transition: {current_status} -> {next_status}.",
                            "fields": {"status": ["This transition is not allowed."]},
                        }
                    },
                    status=400,
                )

    serializer = ProjectProfileSerializer(project, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    changed_fields = [
        field_name
        for field_name, next_value in serializer.validated_data.items()
        if getattr(project, field_name) != next_value
    ]
    if not changed_fields:
        fields = {"non_field_errors": ["No project changes detected."]}
        if "status" in request.data and request.data.get("status") == project.status:
            fields = {
                "status": [
                    f"Project is already {project.status}. Choose a different status or update another field."
                ]
            }
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "No project changes detected.",
                    "fields": fields,
                }
            },
            status=400,
        )
    try:
        serializer.save()
    except DjangoValidationError as exc:
        if hasattr(exc, "message_dict"):
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Project update failed validation.",
                        "fields": exc.message_dict,
                    }
                },
                status=400,
            )
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Project update failed validation.",
                    "fields": {"non_field_errors": exc.messages},
                }
            },
            status=400,
        )
    accepted_total = _project_accepted_contract_totals_map(
        project_ids=[project.id],
        actor_user_ids=actor_user_ids,
    ).get(project.id, Decimal("0"))
    payload = ProjectProfileSerializer(project).data
    payload["accepted_contract_total"] = f"{accepted_total:.2f}"
    return Response({"data": payload})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_financial_summary_view(request, project_id: int):
    """Return normalized AR/AP/CO financial summary plus traceability for one project."""
    membership = _ensure_membership(request.user)
    try:
        project = Project.objects.get(id=project_id, organization_id=membership.organization_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    response_data = _build_project_financial_summary_data(project, request.user)

    return Response({"data": ProjectFinancialSummarySerializer(response_data).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_accounting_export_view(request, project_id: int):
    """Export project accounting summary as JSON or CSV (`export_format` query param)."""
    membership = _ensure_membership(request.user)
    try:
        project = Project.objects.get(id=project_id, organization_id=membership.organization_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    summary = _build_project_financial_summary_data(project, request.user)
    serialized_summary = ProjectFinancialSummarySerializer(summary).data
    export_format = (request.query_params.get("export_format") or "csv").lower()
    generated_at = datetime.now(timezone.utc).isoformat()

    if export_format == "json":
        return Response(
            {
                "data": {
                    "project_id": project.id,
                    "project_name": project.name,
                    "generated_at": generated_at,
                    "summary": {
                        key: value
                        for key, value in serialized_summary.items()
                        if key not in {"project_id", "traceability"}
                    },
                    "traceability": serialized_summary["traceability"],
                }
            }
        )

    csv_buffer = StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(
        [
            "row_type",
            "section",
            "metric",
            "record_id",
            "label",
            "status",
            "amount",
            "endpoint",
        ]
    )

    summary_metrics = [
        "contract_value_original",
        "contract_value_current",
        "accepted_contract_total",
        "approved_change_orders_total",
        "invoiced_to_date",
        "paid_to_date",
        "ar_outstanding",
        "ap_total",
        "ap_paid",
        "ap_outstanding",
        "inbound_unapplied_credit",
        "outbound_unapplied_credit",
    ]
    for metric in summary_metrics:
        writer.writerow(["summary", "summary", metric, "", "", "", serialized_summary[metric], ""])

    for section_name, bucket in serialized_summary["traceability"].items():
        for record in bucket["records"]:
            writer.writerow(
                [
                    "record",
                    section_name,
                    "",
                    record["id"],
                    record["label"],
                    record["status"],
                    record["amount"],
                    record["detail_endpoint"],
                ]
            )

    response = HttpResponse(csv_buffer.getvalue(), content_type="text/csv")
    response["Content-Disposition"] = (
        f'attachment; filename="project-{project.id}-accounting-export.csv"'
    )
    response["X-Export-Generated-At"] = generated_at
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_audit_events_view(request, project_id: int):
    """Return immutable financial audit events for the requested project."""
    membership = _ensure_membership(request.user)
    actor_user_ids = _organization_user_ids(request.user)
    try:
        project = Project.objects.get(id=project_id, organization_id=membership.organization_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    rows = FinancialAuditEvent.objects.filter(
        project=project,
        created_by_id__in=actor_user_ids,
    ).select_related("created_by", "project__customer")
    object_type_filters = [value.strip() for value in request.query_params.getlist("object_type") if value.strip()]
    if len(object_type_filters) == 1 and "," in object_type_filters[0]:
        object_type_filters = [
            value.strip() for value in object_type_filters[0].split(",") if value.strip()
        ]
    if object_type_filters:
        rows = rows.filter(object_type__in=object_type_filters)

    rows = rows.order_by("-created_at", "-id")
    return Response({"data": FinancialAuditEventSerializer(rows, many=True).data})
