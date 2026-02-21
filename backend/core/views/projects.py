import csv
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import StringIO

from django.http import HttpResponse
from django.utils import timezone as django_timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import ChangeOrder, Estimate, FinancialAuditEvent, Invoice, Payment, PaymentAllocation, Project, VendorBill
from core.serializers import (
    AttentionFeedSerializer,
    ChangeImpactSummarySerializer,
    FinancialAuditEventSerializer,
    PortfolioSnapshotSerializer,
    ProjectFinancialSummarySerializer,
    ProjectProfileSerializer,
    QuickJumpSearchSerializer,
    ProjectSerializer,
)

ALLOWED_PROJECT_STATUS_TRANSITIONS = {
    Project.Status.PROSPECT: {
        Project.Status.ACTIVE,
        Project.Status.CANCELLED,
    },
    Project.Status.ACTIVE: {
        Project.Status.ON_HOLD,
        Project.Status.COMPLETED,
        Project.Status.CANCELLED,
    },
    Project.Status.ON_HOLD: {
        Project.Status.ACTIVE,
        Project.Status.COMPLETED,
        Project.Status.CANCELLED,
    },
    Project.Status.COMPLETED: set(),
    Project.Status.CANCELLED: set(),
}


def _parse_optional_date(value: str):
    if not value:
        return None, None
    try:
        return date.fromisoformat(value), None
    except ValueError:
        return None, ["Use YYYY-MM-DD format."]


def _date_filter_from_query(request):
    date_from_raw = (request.query_params.get("date_from") or "").strip()
    date_to_raw = (request.query_params.get("date_to") or "").strip()
    date_from, date_from_error = _parse_optional_date(date_from_raw)
    date_to, date_to_error = _parse_optional_date(date_to_raw)
    fields = {}
    if date_from_error:
        fields["date_from"] = date_from_error
    if date_to_error:
        fields["date_to"] = date_to_error
    if date_from and date_to and date_to < date_from:
        fields["date_to"] = ["date_to must be on or after date_from."]
    if fields:
        return None, None, fields
    return date_from, date_to, None


def _build_project_financial_summary_data(project: Project, user):
    approved_co_rows = list(
        ChangeOrder.objects.filter(
            project=project,
            status=ChangeOrder.Status.APPROVED,
        ).order_by("-created_at", "-id")
    )
    approved_change_orders_total = sum((co.amount_delta for co in approved_co_rows), Decimal("0"))

    invoice_rows = list(
        Invoice.objects.filter(
            project=project,
            created_by=user,
        )
        .exclude(status=Invoice.Status.VOID)
        .order_by("-created_at", "-id")
    )
    invoiced_to_date = sum((invoice.total for invoice in invoice_rows), Decimal("0"))

    inbound_alloc_rows = list(
        PaymentAllocation.objects.filter(
            payment__project=project,
            payment__created_by=user,
            payment__status=Payment.Status.SETTLED,
            payment__direction=Payment.Direction.INBOUND,
        )
        .select_related("payment", "invoice")
        .order_by("-created_at", "-id")
    )
    paid_to_date = sum((row.applied_amount for row in inbound_alloc_rows), Decimal("0"))

    vendor_bill_rows = list(
        VendorBill.objects.filter(
            project=project,
            created_by=user,
        )
        .exclude(status=VendorBill.Status.VOID)
        .order_by("-created_at", "-id")
    )
    ap_total = sum((bill.total for bill in vendor_bill_rows), Decimal("0"))

    outbound_alloc_rows = list(
        PaymentAllocation.objects.filter(
            payment__project=project,
            payment__created_by=user,
            payment__status=Payment.Status.SETTLED,
            payment__direction=Payment.Direction.OUTBOUND,
        )
        .select_related("payment", "vendor_bill")
        .order_by("-created_at", "-id")
    )
    ap_paid = sum((row.applied_amount for row in outbound_alloc_rows), Decimal("0"))

    ar_outstanding = invoiced_to_date - paid_to_date
    ap_outstanding = ap_total - ap_paid

    if ar_outstanding < Decimal("0"):
        ar_outstanding = Decimal("0")
    if ap_outstanding < Decimal("0"):
        ap_outstanding = Decimal("0")

    inbound_payment_rows = list(
        project.payments.filter(
            created_by=user,
            status=Payment.Status.SETTLED,
            direction=Payment.Direction.INBOUND,
        )
    )
    inbound_unapplied_credit = sum((payment.amount for payment in inbound_payment_rows), Decimal("0"))
    inbound_unapplied_credit = inbound_unapplied_credit - paid_to_date
    if inbound_unapplied_credit < Decimal("0"):
        inbound_unapplied_credit = Decimal("0")

    outbound_payment_rows = list(
        project.payments.filter(
            created_by=user,
            status=Payment.Status.SETTLED,
            direction=Payment.Direction.OUTBOUND,
        )
    )
    outbound_disbursed_total = sum((payment.amount for payment in outbound_payment_rows), Decimal("0"))
    outbound_unapplied_credit = outbound_disbursed_total - ap_paid
    if outbound_unapplied_credit < Decimal("0"):
        outbound_unapplied_credit = Decimal("0")

    traceability = {
        "approved_change_orders": {
            "ui_route": "/change-orders",
            "list_endpoint": f"/api/v1/projects/{project.id}/change-orders/",
            "total": f"{approved_change_orders_total:.2f}",
            "records": [
                {
                    "id": row.id,
                    "label": f"CO-{row.number}",
                    "status": row.status,
                    "amount": f"{row.amount_delta:.2f}",
                    "detail_endpoint": f"/api/v1/change-orders/{row.id}/",
                }
                for row in approved_co_rows
            ],
        },
        "ar_invoices": {
            "ui_route": "/invoices",
            "list_endpoint": f"/api/v1/projects/{project.id}/invoices/",
            "total": f"{invoiced_to_date:.2f}",
            "records": [
                {
                    "id": row.id,
                    "label": row.invoice_number,
                    "status": row.status,
                    "amount": f"{row.total:.2f}",
                    "detail_endpoint": f"/api/v1/invoices/{row.id}/",
                }
                for row in invoice_rows
            ],
        },
        "ar_payments": {
            "ui_route": "/payments",
            "list_endpoint": f"/api/v1/projects/{project.id}/payments/",
            "total": f"{paid_to_date:.2f}",
            "records": [
                {
                    "id": row.id,
                    "label": f"PAY-{row.payment_id}",
                    "status": row.payment.status,
                    "amount": f"{row.applied_amount:.2f}",
                    "detail_endpoint": f"/api/v1/payments/{row.payment_id}/",
                }
                for row in inbound_alloc_rows
            ],
        },
        "ap_vendor_bills": {
            "ui_route": "/vendor-bills",
            "list_endpoint": f"/api/v1/projects/{project.id}/vendor-bills/",
            "total": f"{ap_total:.2f}",
            "records": [
                {
                    "id": row.id,
                    "label": row.bill_number,
                    "status": row.status,
                    "amount": f"{row.total:.2f}",
                    "detail_endpoint": f"/api/v1/vendor-bills/{row.id}/",
                }
                for row in vendor_bill_rows
            ],
        },
        "ap_payments": {
            "ui_route": "/payments",
            "list_endpoint": f"/api/v1/projects/{project.id}/payments/",
            "total": f"{ap_paid:.2f}",
            "records": [
                {
                    "id": row.id,
                    "label": f"PAY-{row.payment_id}",
                    "status": row.payment.status,
                    "amount": f"{row.applied_amount:.2f}",
                    "detail_endpoint": f"/api/v1/payments/{row.payment_id}/",
                }
                for row in outbound_alloc_rows
            ],
        },
    }

    return {
        "project_id": project.id,
        "contract_value_original": project.contract_value_original,
        "contract_value_current": project.contract_value_current,
        "approved_change_orders_total": approved_change_orders_total,
        "invoiced_to_date": invoiced_to_date,
        "paid_to_date": paid_to_date,
        "ar_outstanding": ar_outstanding,
        "ap_total": ap_total,
        "ap_paid": ap_paid,
        "ap_outstanding": ap_outstanding,
        "inbound_unapplied_credit": inbound_unapplied_credit,
        "outbound_unapplied_credit": outbound_unapplied_credit,
        "traceability": traceability,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def projects_list_view(request):
    rows = Project.objects.filter(created_by=request.user).select_related("customer")
    return Response({"data": ProjectSerializer(rows, many=True).data})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def project_detail_view(request, project_id: int):
    try:
        project = Project.objects.select_related("customer").get(id=project_id, created_by=request.user)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": ProjectProfileSerializer(project).data})

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
            allowed_statuses = ALLOWED_PROJECT_STATUS_TRANSITIONS.get(current_status, set())
            if next_status not in allowed_statuses:
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
    next_start_date = serializer.validated_data.get("start_date_planned", project.start_date_planned)
    next_end_date = serializer.validated_data.get("end_date_planned", project.end_date_planned)
    if next_start_date and next_end_date and next_end_date < next_start_date:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "end_date_planned cannot be before start_date_planned.",
                    "fields": {"end_date_planned": ["Planned end date must be on or after planned start date."]},
                }
            },
            status=400,
        )
    serializer.save()
    return Response({"data": ProjectProfileSerializer(project).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_financial_summary_view(request, project_id: int):
    try:
        project = Project.objects.get(id=project_id, created_by=request.user)
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
    try:
        project = Project.objects.get(id=project_id, created_by=request.user)
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
    try:
        project = Project.objects.get(id=project_id, created_by=request.user)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    rows = FinancialAuditEvent.objects.filter(
        project=project,
        created_by=request.user,
    ).order_by("-created_at", "-id")
    return Response({"data": FinancialAuditEventSerializer(rows, many=True).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portfolio_snapshot_view(request):
    date_from, date_to, filter_error = _date_filter_from_query(request)
    if filter_error:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid date filters.",
                    "fields": filter_error,
                }
            },
            status=400,
        )

    today = django_timezone.localdate()
    project_rows = list(
        Project.objects.filter(created_by=request.user).select_related("customer").order_by("-created_at", "-id")
    )
    project_summaries = []
    ar_total_outstanding = Decimal("0")
    ap_total_outstanding = Decimal("0")
    active_projects_count = 0

    for project in project_rows:
        if project.status == Project.Status.ACTIVE:
            active_projects_count += 1
        summary = _build_project_financial_summary_data(project, request.user)
        ar_total_outstanding += summary["ar_outstanding"]
        ap_total_outstanding += summary["ap_outstanding"]
        project_summaries.append(
            {
                "project_id": project.id,
                "project_name": project.name,
                "project_status": project.status,
                "ar_outstanding": summary["ar_outstanding"],
                "ap_outstanding": summary["ap_outstanding"],
                "approved_change_orders_total": summary["approved_change_orders_total"],
            }
        )

    overdue_invoices = Invoice.objects.filter(
        project__created_by=request.user,
        created_by=request.user,
        due_date__lt=today,
    ).exclude(status__in=[Invoice.Status.PAID, Invoice.Status.VOID])
    overdue_vendor_bills = VendorBill.objects.filter(
        project__created_by=request.user,
        created_by=request.user,
        due_date__lt=today,
    ).exclude(status__in=[VendorBill.Status.PAID, VendorBill.Status.VOID])

    if date_from:
        overdue_invoices = overdue_invoices.filter(issue_date__gte=date_from)
        overdue_vendor_bills = overdue_vendor_bills.filter(issue_date__gte=date_from)
    if date_to:
        overdue_invoices = overdue_invoices.filter(issue_date__lte=date_to)
        overdue_vendor_bills = overdue_vendor_bills.filter(issue_date__lte=date_to)

    payload = {
        "generated_at": django_timezone.now(),
        "date_filter": {
            "date_from": date_from.isoformat() if date_from else "",
            "date_to": date_to.isoformat() if date_to else "",
        },
        "active_projects_count": active_projects_count,
        "ar_total_outstanding": ar_total_outstanding,
        "ap_total_outstanding": ap_total_outstanding,
        "overdue_invoice_count": overdue_invoices.count(),
        "overdue_vendor_bill_count": overdue_vendor_bills.count(),
        "projects": project_summaries,
    }
    return Response({"data": PortfolioSnapshotSerializer(payload).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def change_impact_summary_view(request):
    date_from, date_to, filter_error = _date_filter_from_query(request)
    if filter_error:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid date filters.",
                    "fields": filter_error,
                }
            },
            status=400,
        )

    approved_rows = ChangeOrder.objects.filter(
        requested_by=request.user,
        status=ChangeOrder.Status.APPROVED,
    ).select_related("project")
    if date_from:
        approved_rows = approved_rows.filter(approved_at__date__gte=date_from)
    if date_to:
        approved_rows = approved_rows.filter(approved_at__date__lte=date_to)

    project_map = {}
    total_amount = Decimal("0")
    total_count = 0
    for row in approved_rows.order_by("project_id", "number", "revision_number"):
        total_amount += row.amount_delta
        total_count += 1
        project_bucket = project_map.setdefault(
            row.project_id,
            {
                "project_id": row.project_id,
                "project_name": row.project.name,
                "approved_change_order_count": 0,
                "approved_change_order_total": Decimal("0"),
            },
        )
        project_bucket["approved_change_order_count"] += 1
        project_bucket["approved_change_order_total"] += row.amount_delta

    payload = {
        "generated_at": django_timezone.now(),
        "date_filter": {
            "date_from": date_from.isoformat() if date_from else "",
            "date_to": date_to.isoformat() if date_to else "",
        },
        "approved_change_order_count": total_count,
        "approved_change_order_total": total_amount,
        "projects": sorted(project_map.values(), key=lambda row: row["approved_change_order_total"], reverse=True),
    }
    return Response({"data": ChangeImpactSummarySerializer(payload).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def attention_feed_view(request):
    today = django_timezone.localdate()
    due_soon_window_days = 7
    due_soon_date = today + timedelta(days=due_soon_window_days)
    items = []

    overdue_invoices = (
        Invoice.objects.filter(
            project__created_by=request.user,
            created_by=request.user,
            due_date__lt=today,
        )
        .exclude(status__in=[Invoice.Status.PAID, Invoice.Status.VOID])
        .select_related("project")
        .order_by("due_date", "id")
    )
    for row in overdue_invoices:
        items.append(
            {
                "kind": "overdue_invoice",
                "severity": "high",
                "label": f"Invoice {row.invoice_number} overdue",
                "detail": f"Status {row.status}, balance due {row.balance_due}",
                "project_id": row.project_id,
                "project_name": row.project.name,
                "ui_route": "/invoices",
                "detail_endpoint": f"/api/v1/invoices/{row.id}/",
                "due_date": row.due_date,
            }
        )

    due_soon_vendor_bills = (
        VendorBill.objects.filter(
            project__created_by=request.user,
            created_by=request.user,
            due_date__gte=today,
            due_date__lte=due_soon_date,
        )
        .exclude(status__in=[VendorBill.Status.PAID, VendorBill.Status.VOID])
        .select_related("project")
        .order_by("due_date", "id")
    )
    for row in due_soon_vendor_bills:
        items.append(
            {
                "kind": "vendor_bill_due_soon",
                "severity": "medium",
                "label": f"Vendor bill {row.bill_number} due soon",
                "detail": f"Status {row.status}, balance due {row.balance_due}",
                "project_id": row.project_id,
                "project_name": row.project.name,
                "ui_route": "/vendor-bills",
                "detail_endpoint": f"/api/v1/vendor-bills/{row.id}/",
                "due_date": row.due_date,
            }
        )

    pending_change_orders = (
        ChangeOrder.objects.filter(
            requested_by=request.user,
            status=ChangeOrder.Status.PENDING_APPROVAL,
        )
        .select_related("project")
        .order_by("-created_at", "-id")
    )
    for row in pending_change_orders:
        items.append(
            {
                "kind": "change_order_pending_approval",
                "severity": "medium",
                "label": f"CO-{row.number} pending approval",
                "detail": f"{row.title} | amount delta {row.amount_delta}",
                "project_id": row.project_id,
                "project_name": row.project.name,
                "ui_route": "/change-orders",
                "detail_endpoint": f"/api/v1/change-orders/{row.id}/",
                "due_date": None,
            }
        )

    problem_payments = (
        Payment.objects.filter(
            project__created_by=request.user,
            created_by=request.user,
            status__in=[Payment.Status.FAILED, Payment.Status.VOID],
        )
        .select_related("project")
        .order_by("-payment_date", "-id")
    )
    for row in problem_payments:
        severity = "high" if row.status == Payment.Status.FAILED else "low"
        items.append(
            {
                "kind": "payment_problem",
                "severity": severity,
                "label": f"Payment #{row.id} {row.status}",
                "detail": f"{row.direction} {row.amount} via {row.method}",
                "project_id": row.project_id,
                "project_name": row.project.name,
                "ui_route": "/payments",
                "detail_endpoint": f"/api/v1/payments/{row.id}/",
                "due_date": None,
            }
        )

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    items = sorted(
        items,
        key=lambda row: (
            severity_rank.get(row["severity"], 9),
            row["due_date"] or today,
            row["project_id"],
        ),
    )
    payload = {
        "generated_at": django_timezone.now(),
        "due_soon_window_days": due_soon_window_days,
        "item_count": len(items),
        "items": items,
    }
    return Response({"data": AttentionFeedSerializer(payload).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def quick_jump_search_view(request):
    query = (request.query_params.get("q") or "").strip()
    if len(query) < 2:
        return Response({"data": QuickJumpSearchSerializer({"query": query, "item_count": 0, "items": []}).data})

    query_lower = query.lower()
    items = []

    projects = Project.objects.filter(created_by=request.user).select_related("customer")
    for row in projects:
        if query_lower in row.name.lower() or query_lower in str(row.id):
            items.append(
                {
                    "kind": "project",
                    "record_id": row.id,
                    "label": row.name,
                    "sub_label": f"Project #{row.id} ({row.status})",
                    "project_id": row.id,
                    "project_name": row.name,
                    "ui_href": f"/projects?project={row.id}",
                    "detail_endpoint": f"/api/v1/projects/{row.id}/",
                }
            )

    estimates = Estimate.objects.filter(created_by=request.user).select_related("project")
    for row in estimates:
        if (
            query_lower in (row.title or "").lower()
            or query_lower in str(row.id)
            or query_lower in str(row.version)
        ):
            items.append(
                {
                    "kind": "estimate",
                    "record_id": row.id,
                    "label": row.title or f"Estimate #{row.id}",
                    "sub_label": f"Estimate #{row.id} v{row.version} ({row.status})",
                    "project_id": row.project_id,
                    "project_name": row.project.name,
                    "ui_href": f"/projects/{row.project_id}/estimates?estimate={row.id}",
                    "detail_endpoint": f"/api/v1/estimates/{row.id}/",
                }
            )

    change_orders = ChangeOrder.objects.filter(requested_by=request.user).select_related("project")
    for row in change_orders:
        candidate = f"co-{row.number} v{row.revision_number} {row.title or ''}".lower()
        if query_lower in candidate or query_lower in str(row.id):
            items.append(
                {
                    "kind": "change_order",
                    "record_id": row.id,
                    "label": f"CO-{row.number} v{row.revision_number}",
                    "sub_label": f"{row.title} ({row.status})",
                    "project_id": row.project_id,
                    "project_name": row.project.name,
                    "ui_href": f"/projects/{row.project_id}/change-orders",
                    "detail_endpoint": f"/api/v1/change-orders/{row.id}/",
                }
            )

    invoices = Invoice.objects.filter(created_by=request.user).select_related("project")
    for row in invoices:
        if query_lower in row.invoice_number.lower() or query_lower in str(row.id):
            items.append(
                {
                    "kind": "invoice",
                    "record_id": row.id,
                    "label": row.invoice_number,
                    "sub_label": f"Invoice #{row.id} ({row.status})",
                    "project_id": row.project_id,
                    "project_name": row.project.name,
                    "ui_href": f"/invoices?project={row.project_id}",
                    "detail_endpoint": f"/api/v1/invoices/{row.id}/",
                }
            )

    vendor_bills = VendorBill.objects.filter(created_by=request.user).select_related("project")
    for row in vendor_bills:
        if query_lower in row.bill_number.lower() or query_lower in str(row.id):
            items.append(
                {
                    "kind": "vendor_bill",
                    "record_id": row.id,
                    "label": row.bill_number,
                    "sub_label": f"Vendor bill #{row.id} ({row.status})",
                    "project_id": row.project_id,
                    "project_name": row.project.name,
                    "ui_href": f"/vendor-bills?project={row.project_id}",
                    "detail_endpoint": f"/api/v1/vendor-bills/{row.id}/",
                }
            )

    payments = Payment.objects.filter(created_by=request.user).select_related("project")
    for row in payments:
        candidate = f"{row.reference_number or ''} {row.id} {row.direction} {row.status}".lower()
        if query_lower in candidate:
            items.append(
                {
                    "kind": "payment",
                    "record_id": row.id,
                    "label": row.reference_number or f"Payment #{row.id}",
                    "sub_label": f"{row.direction} {row.status} amount {row.amount}",
                    "project_id": row.project_id,
                    "project_name": row.project.name,
                    "ui_href": f"/payments?project={row.project_id}",
                    "detail_endpoint": f"/api/v1/payments/{row.id}/",
                }
            )

    deduped = {}
    for row in items:
        key = (row["kind"], row["record_id"])
        deduped[key] = row
    sorted_items = sorted(
        deduped.values(),
        key=lambda row: (row["kind"], row["label"].lower(), row["record_id"]),
    )[:40]

    payload = {
        "query": query,
        "item_count": len(sorted_items),
        "items": sorted_items,
    }
    return Response({"data": QuickJumpSearchSerializer(payload).data})
