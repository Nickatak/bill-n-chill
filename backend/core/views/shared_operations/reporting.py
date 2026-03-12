"""Cross-project reporting and dashboard endpoints."""

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone as django_timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    Estimate,
    EstimateStatusEvent,
    Invoice,
    Payment,
    Project,
    VendorBill,
)
from core.serializers import (
    AttentionFeedSerializer,
    ChangeImpactSummarySerializer,
    PortfolioSnapshotSerializer,
    ProjectTimelineSerializer,
    QuickJumpSearchSerializer,
)
from core.views.helpers import _ensure_membership
from core.views.shared_operations.projects_helpers import (
    _build_project_financial_summary_data,
    _date_filter_from_query,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portfolio_snapshot_view(request):
    """Return portfolio-level snapshot metrics with optional date filtering."""
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

    membership = _ensure_membership(request.user)
    today = django_timezone.localdate()
    project_rows = list(
        Project.objects.filter(organization_id=membership.organization_id)
        .select_related("customer")
        .order_by("-created_at", "-id")
    )
    project_summaries = []
    ar_total_outstanding = Decimal("0")
    ap_total_outstanding = Decimal("0")
    active_projects_count = 0

    for project in project_rows:
        if project.status == Project.Status.ACTIVE:
            active_projects_count += 1
        summary = _build_project_financial_summary_data(
            project,
            request.user,
        )
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
        project__organization_id=membership.organization_id,
        due_date__lt=today,
    ).exclude(status__in=[Invoice.Status.PAID, Invoice.Status.VOID])
    overdue_vendor_bills = VendorBill.objects.filter(
        project__organization_id=membership.organization_id,
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
    """Return approved change-order impact totals, grouped by project, with date filters."""
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

    membership = _ensure_membership(request.user)
    approved_rows = ChangeOrder.objects.filter(
        project__organization_id=membership.organization_id,
        status=ChangeOrder.Status.APPROVED,
    ).select_related("project")
    if date_from:
        approved_rows = approved_rows.filter(approved_at__date__gte=date_from)
    if date_to:
        approved_rows = approved_rows.filter(approved_at__date__lte=date_to)

    project_map = {}
    total_amount = Decimal("0")
    total_count = 0
    for row in approved_rows.order_by("project_id", "family_key", "revision_number"):
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
    """Return prioritized operational attention items (overdue, pending, and problem states)."""
    membership = _ensure_membership(request.user)
    today = django_timezone.localdate()
    due_soon_window_days = 7
    due_soon_date = today + timedelta(days=due_soon_window_days)
    items = []

    overdue_invoices = (
        Invoice.objects.filter(
            project__organization_id=membership.organization_id,
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
                "ui_route": f"/projects/{row.project_id}/invoices",
                "detail_endpoint": f"/api/v1/invoices/{row.id}/",
                "due_date": row.due_date,
            }
        )

    due_soon_vendor_bills = (
        VendorBill.objects.filter(
            project__organization_id=membership.organization_id,
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
            project__organization_id=membership.organization_id,
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
                "label": f"CO-{row.family_key} pending approval",
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
            project__organization_id=membership.organization_id,
            status=Payment.Status.VOID,
        )
        .select_related("project")
        .order_by("-payment_date", "-id")
    )
    for row in problem_payments:
        ui_route = "/payments"
        items.append(
            {
                "kind": "payment_problem",
                "severity": "low",
                "label": f"Payment #{row.id} {row.status}",
                "detail": f"{row.direction} {row.amount} via {row.method}",
                "project_id": row.project_id,
                "project_name": row.project.name,
                "ui_route": ui_route,
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
    """Search key entities by lightweight text query for fast navigation jump points."""
    query = (request.query_params.get("q") or "").strip()
    if len(query) < 2:
        return Response({"data": QuickJumpSearchSerializer({"query": query, "item_count": 0, "items": []}).data})

    membership = _ensure_membership(request.user)
    query_lower = query.lower()
    items = []

    projects = Project.objects.filter(organization_id=membership.organization_id).select_related("customer")
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

    estimates = Estimate.objects.filter(project__organization_id=membership.organization_id).select_related("project")
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

    change_orders = ChangeOrder.objects.filter(project__organization_id=membership.organization_id).select_related("project")
    for row in change_orders:
        candidate = f"co-{row.family_key} v{row.revision_number} {row.title or ''}".lower()
        if query_lower in candidate or query_lower in str(row.id):
            items.append(
                {
                    "kind": "change_order",
                    "record_id": row.id,
                    "label": f"CO-{row.family_key} v{row.revision_number}",
                    "sub_label": f"{row.title} ({row.status})",
                    "project_id": row.project_id,
                    "project_name": row.project.name,
                    "ui_href": f"/projects/{row.project_id}/change-orders",
                    "detail_endpoint": f"/api/v1/change-orders/{row.id}/",
                }
            )

    invoices = Invoice.objects.filter(project__organization_id=membership.organization_id).select_related("project")
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

    vendor_bills = VendorBill.objects.filter(project__organization_id=membership.organization_id).select_related("project")
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

    payments = Payment.objects.filter(project__organization_id=membership.organization_id).select_related("project")
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
                    "ui_href": f"/financials-auditing?project={row.project_id}",
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_timeline_events_view(request, project_id: int):
    """Return merged project timeline events by category (`all|financial|workflow`)."""
    membership = _ensure_membership(request.user)
    try:
        project = Project.objects.get(id=project_id, organization_id=membership.organization_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    category = (request.query_params.get("category") or "all").strip().lower()
    if category not in {"all", "financial", "workflow"}:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid category filter.",
                    "fields": {"category": ["Use one of: all, financial, workflow."]},
                }
            },
            status=400,
        )

    items = []
    if category in {"all", "workflow"}:
        workflow_rows = (
            EstimateStatusEvent.objects.filter(
                estimate__project=project,
            )
            .select_related("estimate")
            .order_by("-changed_at", "-id")
        )
        for row in workflow_rows:
            items.append(
                {
                    "timeline_id": f"workflow-estimate-{row.id}",
                    "category": "workflow",
                    "event_type": "estimate_status_event",
                    "occurred_at": row.changed_at,
                    "label": f"estimate {row.from_status or 'new'} -> {row.to_status}",
                    "detail": row.note or "",
                    "object_type": "estimate",
                    "object_id": row.estimate_id,
                    "ui_route": f"/projects/{project.id}/estimates?estimate={row.estimate_id}",
                    "detail_endpoint": f"/api/v1/estimates/{row.estimate_id}/status-events/",
                }
            )

    sorted_items = sorted(items, key=lambda row: row["occurred_at"], reverse=True)
    payload = {
        "project_id": project.id,
        "project_name": project.name,
        "category": category,
        "item_count": len(sorted_items),
        "items": sorted_items,
    }
    return Response({"data": ProjectTimelineSerializer(payload).data})
