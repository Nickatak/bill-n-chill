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

from core.models import ChangeOrder, Quote, Project
from core.serializers import (
    ChangeOrderSerializer,
    QuoteLineItemSerializer,
    ProjectFinancialSummarySerializer,
    ProjectProfileSerializer,
    ProjectSerializer,
)
from core.views.helpers import _capability_gate, _ensure_org_membership
from core.views.shared_operations.projects_helpers import (
    _build_project_financial_summary_data,
    _prefetch_project_qs,
    _project_accepted_contract_totals_map,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def projects_list_view(request):
    """List all projects for the caller's organization.

    Each project is annotated with its ``accepted_contract_total`` (sum of
    the latest approved quote grand total per title family).

    Flow:
        1. Scope to user's org, load customer relations.
        2. Compute accepted contract totals across all projects in one batch.
        3. Merge totals into serialized output.

    URL: ``GET /api/v1/projects/``

    Request body: (none)

    Success 200::

        { "data": [{ ..., "accepted_contract_total": "15000.00" }, ...] }
    """
    membership = _ensure_org_membership(request.user)
    projects = list(
        _prefetch_project_qs(Project.objects.filter(organization_id=membership.organization_id))
    )
    accepted_totals_by_project = _project_accepted_contract_totals_map(
        project_ids=[project.id for project in projects],
    )
    serialized_projects = ProjectSerializer(projects, many=True).data
    for project_data in serialized_projects:
        project_id = int(project_data.get("id"))
        accepted_total = accepted_totals_by_project.get(project_id, Decimal("0"))
        project_data["accepted_contract_total"] = f"{accepted_total:.2f}"
    return Response({"data": serialized_projects})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def project_detail_view(request, project_id):
    """Fetch or update a project profile.

    GET returns the full project profile with ``accepted_contract_total``.
    PATCH applies partial updates with guards for terminal-state projects,
    immutable contract fields, and invalid status transitions.

    Flow (GET):
        1. Look up project scoped to user's org.
        2. Compute accepted contract total.
        3. Return serialized profile.

    Flow (PATCH):
        1. Capability gate: ``projects.edit``.
        2. Reject if project is in terminal state (completed/cancelled).
        3. Reject if attempting to change immutable contract fields.
        4. Validate status transition if status is being changed.
        5. Detect changed fields — reject if nothing changed.
        6. Save and return updated profile.

    URL: ``GET/PATCH /api/v1/projects/<project_id>/``

    Request body (PATCH)::

        { "name": "Updated Name", "status": "active" }

    Success 200::

        { "data": { ..., "accepted_contract_total": "15000.00" } }

    Errors:
        - 400: Terminal state, immutable field, invalid transition, no changes, or validation error.
        - 403: Missing ``projects.edit`` capability.
        - 404: Project not found.
    """
    membership = _ensure_org_membership(request.user)
    try:
        project = _prefetch_project_qs(Project.objects).get(
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
        ).get(project.id, Decimal("0"))
        payload = ProjectProfileSerializer(project).data
        payload["accepted_contract_total"] = f"{accepted_total:.2f}"
        return Response({"data": payload})

    elif request.method == "PATCH":
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
        ).get(project.id, Decimal("0"))
        payload = ProjectProfileSerializer(project).data
        payload["accepted_contract_total"] = f"{accepted_total:.2f}"
        return Response({"data": payload})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_financial_summary_view(request, project_id):
    """Return normalized AR/AP/CO financial summary with traceability for one project.

    Aggregates contract values, invoiced/paid amounts, outstanding balances,
    and per-record traceability links.  Used by the project overview page.

    Flow:
        1. Look up project scoped to user's org.
        2. Build financial summary via ``_build_project_financial_summary_data``.
        3. Serialize and return.

    URL: ``GET /api/v1/projects/<project_id>/financial-summary/``

    Request body: (none)

    Success 200::

        { "data": { "contract_value_original": "...", "invoiced_to_date": "...", "traceability": {...} } }

    Errors:
        - 404: Project not found.
    """
    membership = _ensure_org_membership(request.user)
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
def project_accounting_export_view(request, project_id):
    """Export project accounting summary as JSON or CSV.

    Accepts ``?export_format=json`` or ``?export_format=csv`` (default: csv).
    CSV includes summary metrics as rows plus per-record traceability lines.

    Flow:
        1. Look up project scoped to user's org.
        2. Build and serialize financial summary.
        3. If ``export_format=json``, return structured JSON response.
        4. Otherwise build CSV with summary metric rows + traceability record rows.

    URL: ``GET /api/v1/projects/<project_id>/accounting-export/?export_format=csv``

    Request body: (none)

    Success 200 (JSON)::

        { "data": { "project_id": 1, "generated_at": "...", "summary": {...}, "traceability": {...} } }

    Success 200 (CSV): ``text/csv`` attachment with summary + record rows.

    Errors:
        - 404: Project not found.
    """
    membership = _ensure_org_membership(request.user)
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
def project_contract_breakdown_view(request, project_id):
    """Return the active quote and approved change orders for a project.

    Returns the most recently approved quote with its line items, plus all
    approved change orders linked to the project with their line items.  If no
    approved quote exists, returns nulls.

    Flow:
        1. Look up project scoped to user's org.
        2. Find the most recently approved quote (if any).
        3. Fetch all approved change orders for the project.
        4. Return combined payload.

    URL: ``GET /api/v1/projects/<project_id>/contract-breakdown/``

    Request body: (none)

    Success 200::

        { "data": { "active_quote": { ... }, "approved_change_orders": [{ ... }, ...] } }

    Errors:
        - 404: Project not found.
    """
    membership = _ensure_org_membership(request.user)
    try:
        project = Project.objects.get(id=project_id, organization_id=membership.organization_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    # Find the most recently approved quote.
    active_quote = (
        Quote.objects.filter(project=project, status=Quote.Status.APPROVED)
        .prefetch_related("line_items", "line_items__cost_code")
        .order_by("-created_at", "-id")
        .first()
    )

    if not active_quote:
        return Response({"data": {"active_quote": None, "approved_change_orders": []}})

    quote_data = {
        "id": active_quote.id,
        "title": active_quote.title,
        "version": active_quote.version,
        "grand_total": str(active_quote.grand_total),
        "line_items": QuoteLineItemSerializer(
            active_quote.line_items.select_related("cost_code").all(), many=True
        ).data,
    }

    approved_cos = (
        ChangeOrder.objects.filter(
            project=project,
            status="approved",
        )
        .prefetch_related("line_items", "line_items__cost_code")
        .order_by("created_at", "id")
    )

    return Response({
        "data": {
            "active_quote": quote_data,
            "approved_change_orders": [ChangeOrderSerializer(change_order).data for change_order in approved_cos],
        }
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_audit_events_view(request, project_id):
    """Audit events endpoint — removed. Returns an empty list for backward compatibility.

    URL: ``GET /api/v1/projects/<project_id>/audit-events/``

    Success 200::

        { "data": [] }
    """
    return Response({"data": []})
