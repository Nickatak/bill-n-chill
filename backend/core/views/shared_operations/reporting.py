"""Cross-project reporting and dashboard endpoints."""

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone as django_timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    ChangeOrderSnapshot,
    Estimate,
    EstimateStatusEvent,
    Invoice,
    InvoiceStatusEvent,
    Payment,
    PaymentRecord,
    Project,
    VendorBill,
    VendorBillSnapshot,
)
from core.serializers import (
    AttentionFeedSerializer,
    ChangeImpactSummarySerializer,
    PortfolioSnapshotSerializer,
    ProjectTimelineSerializer,
    QuickJumpSearchSerializer,
)
from core.views.helpers import _ensure_org_membership
from core.views.shared_operations.projects_helpers import (
    _build_project_financial_summary_data,
    _date_filter_from_query,
)
from core.views.shared_operations.reporting_helpers import (
    DUE_SOON_WINDOW_DAYS,
    QUICK_JUMP_RESULT_LIMIT,
    SEVERITY_RANK,
    VALID_TIMELINE_CATEGORIES,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def portfolio_snapshot_view(request):
    """Return portfolio-level financial snapshot across all projects.

    Aggregates AR/AP outstanding totals, active project counts, and overdue
    document counts.  Supports optional ``date_from``/``date_to`` query
    params that filter overdue-document windows by issue date.

    Flow:
        1. Validate optional date filters.
        2. Load all org projects and compute per-project financial summaries.
        3. Accumulate portfolio-wide AR/AP outstanding totals.
        4. Count overdue invoices and vendor bills (optionally date-filtered).
        5. Return serialized snapshot.

    URL: ``GET /api/v1/reports/portfolio/``

    Request body: (none)

    Success 200::

        { "data": { "active_projects_count": 5, "ar_total_outstanding": "12000.00", ... } }

    Errors:
        - 400: Invalid date filter format.
    """
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

    membership = _ensure_org_membership(request.user)
    today = django_timezone.localdate()
    projects = list(
        Project.objects.filter(organization_id=membership.organization_id)
        .select_related("customer")
        .order_by("-created_at", "-id")
    )
    project_summaries = []
    ar_total_outstanding = Decimal("0")
    ap_total_outstanding = Decimal("0")
    active_projects_count = 0

    for project in projects:
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
    ).exclude(status__in=[Invoice.Status.CLOSED, Invoice.Status.VOID])
    overdue_vendor_bills = VendorBill.objects.filter(
        project__organization_id=membership.organization_id,
        due_date__lt=today,
    ).exclude(status__in=[VendorBill.Status.CLOSED, VendorBill.Status.VOID])

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
    """Return approved change-order impact totals grouped by project.

    Aggregates approved change-order deltas across the organization,
    optionally filtered by approval date range.  Projects are sorted by
    total impact descending.

    Flow:
        1. Validate optional date filters.
        2. Query approved change orders, optionally filtered by approval date.
        3. Group by project and accumulate totals.
        4. Return serialized summary sorted by impact.

    URL: ``GET /api/v1/reports/change-impact/``

    Request body: (none)

    Success 200::

        { "data": { "approved_change_orders_count": 8, "approved_change_orders_total": "45000.00", "projects": [...] } }

    Errors:
        - 400: Invalid date filter format.
    """
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

    membership = _ensure_org_membership(request.user)
    approved_change_orders = ChangeOrder.objects.filter(
        project__organization_id=membership.organization_id,
        status=ChangeOrder.Status.APPROVED,
    ).select_related("project")
    if date_from:
        approved_change_orders = approved_change_orders.filter(approved_at__date__gte=date_from)
    if date_to:
        approved_change_orders = approved_change_orders.filter(approved_at__date__lte=date_to)

    project_map = {}
    total_amount = Decimal("0")
    total_count = 0
    for change_order in approved_change_orders.order_by("project_id", "family_key"):
        total_amount += change_order.amount_delta
        total_count += 1
        project_bucket = project_map.setdefault(
            change_order.project_id,
            {
                "project_id": change_order.project_id,
                "project_name": change_order.project.name,
                "approved_change_orders_count": 0,
                "approved_change_orders_total": Decimal("0"),
            },
        )
        project_bucket["approved_change_orders_count"] += 1
        project_bucket["approved_change_orders_total"] += change_order.amount_delta

    payload = {
        "generated_at": django_timezone.now(),
        "date_filter": {
            "date_from": date_from.isoformat() if date_from else "",
            "date_to": date_to.isoformat() if date_to else "",
        },
        "approved_change_orders_count": total_count,
        "approved_change_orders_total": total_amount,
        "projects": sorted(project_map.values(), key=lambda p: p["approved_change_orders_total"], reverse=True),
    }
    return Response({"data": ChangeImpactSummarySerializer(payload).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def attention_feed_view(request):
    """Return prioritized operational attention items requiring action.

    Scans for overdue invoices, soon-due vendor bills, pending change orders,
    and voided payments.  Items are ranked by severity (high -> medium -> low),
    then by due date and project.

    Flow:
        1. Query overdue invoices (high severity).
        2. Query vendor bills due within ``DUE_SOON_WINDOW_DAYS`` (medium severity).
        3. Query pending-approval change orders (medium severity).
        4. Query voided payments (low severity).
        5. Sort by severity rank, due date, and project.

    URL: ``GET /api/v1/reports/attention-feed/``

    Request body: (none)

    Success 200::

        { "data": { "item_count": 12, "items": [{ "kind": "overdue_invoice", "severity": "high", ... }, ...] } }
    """
    membership = _ensure_org_membership(request.user)
    today = django_timezone.localdate()
    due_soon_date = today + timedelta(days=DUE_SOON_WINDOW_DAYS)
    items = []

    overdue_invoices = (
        Invoice.objects.filter(
            project__organization_id=membership.organization_id,
            due_date__lt=today,
        )
        .exclude(status__in=[Invoice.Status.CLOSED, Invoice.Status.VOID])
        .select_related("project")
        .order_by("due_date", "id")
    )
    for invoice in overdue_invoices:
        items.append(
            {
                "kind": "overdue_invoice",
                "severity": "high",
                "label": f"Invoice {invoice.invoice_number} overdue",
                "detail": f"Status {invoice.status}, balance due {invoice.balance_due}",
                "project_id": invoice.project_id,
                "project_name": invoice.project.name,
                "ui_route": f"/projects/{invoice.project_id}/invoices",
                "detail_endpoint": f"/api/v1/invoices/{invoice.id}/",
                "due_date": invoice.due_date,
            }
        )

    due_soon_vendor_bills = (
        VendorBill.objects.filter(
            project__organization_id=membership.organization_id,
            due_date__gte=today,
            due_date__lte=due_soon_date,
        )
        .exclude(status__in=[VendorBill.Status.CLOSED, VendorBill.Status.VOID])
        .select_related("project")
        .order_by("due_date", "id")
    )
    for vendor_bill in due_soon_vendor_bills:
        items.append(
            {
                "kind": "vendor_bill_due_soon",
                "severity": "medium",
                "label": f"Vendor bill {vendor_bill.bill_number} due soon",
                "detail": f"Status {vendor_bill.status}, balance due {vendor_bill.balance_due}",
                "project_id": vendor_bill.project_id,
                "project_name": vendor_bill.project.name,
                "ui_route": "/vendor-bills",
                "detail_endpoint": f"/api/v1/vendor-bills/{vendor_bill.id}/",
                "due_date": vendor_bill.due_date,
            }
        )

    pending_change_orders = (
        ChangeOrder.objects.filter(
            project__organization_id=membership.organization_id,
            status=ChangeOrder.Status.SENT,
        )
        .select_related("project")
        .order_by("-created_at", "-id")
    )
    for change_order in pending_change_orders:
        items.append(
            {
                "kind": "change_order_sent",
                "severity": "medium",
                "label": f"CO-{change_order.family_key} awaiting approval",
                "detail": f"{change_order.title} | amount delta {change_order.amount_delta}",
                "project_id": change_order.project_id,
                "project_name": change_order.project.name,
                "ui_route": "/change-orders",
                "detail_endpoint": f"/api/v1/change-orders/{change_order.id}/",
                "due_date": None,
            }
        )

    problem_payments = (
        Payment.objects.filter(
            organization_id=membership.organization_id,
            status=Payment.Status.VOID,
        )
        .select_related("project")
        .order_by("-payment_date", "-id")
    )
    for payment in problem_payments:
        items.append(
            {
                "kind": "payment_problem",
                "severity": "low",
                "label": f"Payment #{payment.id} {payment.status}",
                "detail": f"{payment.direction} {payment.amount} via {payment.method}",
                "project_id": payment.project_id,
                "project_name": payment.project.name if payment.project_id else "",
                "ui_route": "/payments",
                "detail_endpoint": f"/api/v1/payments/{payment.id}/",
                "due_date": None,
            }
        )

    items = sorted(
        items,
        key=lambda item: (
            SEVERITY_RANK.get(item["severity"], 9),
            item["due_date"] or today,
            item["project_id"],
        ),
    )
    payload = {
        "generated_at": django_timezone.now(),
        "due_soon_window_days": DUE_SOON_WINDOW_DAYS,
        "item_count": len(items),
        "items": items,
    }
    return Response({"data": AttentionFeedSerializer(payload).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def quick_jump_search_view(request):
    """Search key entities by text query for fast navigation jump points.

    Performs a lightweight in-memory search across projects, estimates,
    change orders, invoices, vendor bills, and payments.  Requires a
    minimum 2-character query.  Results are deduped, sorted, and capped
    at ``QUICK_JUMP_RESULT_LIMIT`` items.

    Flow:
        1. Validate minimum query length (2 characters).
        2. Search each entity type for case-insensitive text matches.
        3. Deduplicate results by (kind, record_id).
        4. Sort and cap at result limit.

    URL: ``GET /api/v1/search/quick-jump/?q=<query>``

    Request body: (none)

    Success 200::

        { "data": { "query": "INV", "item_count": 3, "items": [{ "kind": "invoice", ... }, ...] } }
    """
    query = (request.query_params.get("q") or "").strip()
    if len(query) < 2:
        return Response({"data": QuickJumpSearchSerializer({"query": query, "item_count": 0, "items": []}).data})

    membership = _ensure_org_membership(request.user)
    query_lower = query.lower()
    items = []

    projects = Project.objects.filter(organization_id=membership.organization_id).select_related("customer")
    for project in projects:
        if query_lower in project.name.lower() or query_lower in str(project.id):
            items.append(
                {
                    "kind": "project",
                    "record_id": project.id,
                    "label": project.name,
                    "sub_label": f"Project #{project.id} ({project.status})",
                    "project_id": project.id,
                    "project_name": project.name,
                    "ui_href": f"/projects?project={project.id}",
                    "detail_endpoint": f"/api/v1/projects/{project.id}/",
                }
            )

    estimates = Estimate.objects.filter(project__organization_id=membership.organization_id).select_related("project")
    for estimate in estimates:
        if (
            query_lower in (estimate.title or "").lower()
            or query_lower in str(estimate.id)
            or query_lower in str(estimate.version)
        ):
            items.append(
                {
                    "kind": "estimate",
                    "record_id": estimate.id,
                    "label": estimate.title or f"Estimate #{estimate.id}",
                    "sub_label": f"Estimate #{estimate.id} v{estimate.version} ({estimate.status})",
                    "project_id": estimate.project_id,
                    "project_name": estimate.project.name,
                    "ui_href": f"/projects/{estimate.project_id}/estimates?estimate={estimate.id}",
                    "detail_endpoint": f"/api/v1/estimates/{estimate.id}/",
                }
            )

    change_orders = ChangeOrder.objects.filter(project__organization_id=membership.organization_id).select_related("project")
    for change_order in change_orders:
        candidate = f"co-{change_order.family_key} {change_order.title or ''}".lower()
        if query_lower in candidate or query_lower in str(change_order.id):
            items.append(
                {
                    "kind": "change_order",
                    "record_id": change_order.id,
                    "label": f"CO-{change_order.family_key}",
                    "sub_label": f"{change_order.title} ({change_order.status})",
                    "project_id": change_order.project_id,
                    "project_name": change_order.project.name,
                    "ui_href": f"/projects/{change_order.project_id}/change-orders",
                    "detail_endpoint": f"/api/v1/change-orders/{change_order.id}/",
                }
            )

    invoices = Invoice.objects.filter(project__organization_id=membership.organization_id).select_related("project")
    for invoice in invoices:
        if query_lower in invoice.invoice_number.lower() or query_lower in str(invoice.id):
            items.append(
                {
                    "kind": "invoice",
                    "record_id": invoice.id,
                    "label": invoice.invoice_number,
                    "sub_label": f"Invoice #{invoice.id} ({invoice.status})",
                    "project_id": invoice.project_id,
                    "project_name": invoice.project.name,
                    "ui_href": f"/invoices?project={invoice.project_id}",
                    "detail_endpoint": f"/api/v1/invoices/{invoice.id}/",
                }
            )

    vendor_bills = VendorBill.objects.filter(project__organization_id=membership.organization_id).select_related("project")
    for vendor_bill in vendor_bills:
        if query_lower in vendor_bill.bill_number.lower() or query_lower in str(vendor_bill.id):
            items.append(
                {
                    "kind": "vendor_bill",
                    "record_id": vendor_bill.id,
                    "label": vendor_bill.bill_number,
                    "sub_label": f"Vendor bill #{vendor_bill.id} ({vendor_bill.status})",
                    "project_id": vendor_bill.project_id,
                    "project_name": vendor_bill.project.name,
                    "ui_href": f"/vendor-bills?project={vendor_bill.project_id}",
                    "detail_endpoint": f"/api/v1/vendor-bills/{vendor_bill.id}/",
                }
            )

    payments = Payment.objects.filter(organization_id=membership.organization_id).select_related("project")
    for payment in payments:
        candidate = f"{payment.reference_number or ''} {payment.id} {payment.direction} {payment.status}".lower()
        if query_lower in candidate:
            items.append(
                {
                    "kind": "payment",
                    "record_id": payment.id,
                    "label": payment.reference_number or f"Payment #{payment.id}",
                    "sub_label": f"{payment.direction} {payment.status} amount {payment.amount}",
                    "project_id": payment.project_id,
                    "project_name": payment.project.name if payment.project_id else "",
                    "ui_href": "/payments",
                    "detail_endpoint": f"/api/v1/payments/{payment.id}/",
                }
            )

    deduped = {}
    for item in items:
        key = (item["kind"], item["record_id"])
        deduped[key] = item
    sorted_items = sorted(
        deduped.values(),
        key=lambda item: (item["kind"], item["label"].lower(), item["record_id"]),
    )[:QUICK_JUMP_RESULT_LIMIT]

    payload = {
        "query": query,
        "item_count": len(sorted_items),
        "items": sorted_items,
    }
    return Response({"data": QuickJumpSearchSerializer(payload).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_timeline_events_view(request, project_id):
    """Return merged project timeline events filtered by category.

    Queries all project-scoped audit models and merges them into a
    unified timeline.  Supports category filtering: ``all`` (default),
    ``financial`` (payments, vendor bill snapshots), or ``workflow``
    (estimate/invoice status events, change order snapshots).

    Flow:
        1. Look up project scoped to user's org.
        2. Validate category filter.
        3. Query workflow events if category allows.
        4. Query financial events if category allows.
        5. Sort all items by timestamp descending.

    URL: ``GET /api/v1/projects/<project_id>/timeline/?category=all``

    Request body: (none)

    Success 200::

        { "data": { "project_id": 1, "category": "all", "item_count": 25, "items": [...] } }

    Errors:
        - 400: Invalid category filter.
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

    category = (request.query_params.get("category") or "all").strip().lower()
    if category not in VALID_TIMELINE_CATEGORIES:
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

    # --- Workflow events ---
    if category in {"all", "workflow"}:
        for event in (
            EstimateStatusEvent.objects.filter(estimate__project=project)
            .select_related("estimate")
            .order_by("-changed_at", "-id")
        ):
            items.append({
                "timeline_id": f"estimate-event-{event.id}",
                "category": "workflow",
                "event_type": "estimate_status",
                "occurred_at": event.changed_at,
                "label": f"Estimate {event.from_status or 'new'} → {event.to_status}",
                "detail": event.note or "",
                "object_type": "estimate",
                "object_id": event.estimate_id,
                "ui_route": f"/projects/{project.id}/estimates?estimate={event.estimate_id}",
            })

        for event in (
            InvoiceStatusEvent.objects.filter(invoice__project=project)
            .select_related("invoice")
            .order_by("-changed_at", "-id")
        ):
            items.append({
                "timeline_id": f"invoice-event-{event.id}",
                "category": "workflow",
                "event_type": "invoice_status",
                "occurred_at": event.changed_at,
                "label": f"Invoice {event.from_status or 'new'} → {event.to_status}",
                "detail": event.note or "",
                "object_type": "invoice",
                "object_id": event.invoice_id,
                "ui_route": f"/projects/{project.id}/invoices?invoice={event.invoice_id}",
            })

        for snapshot in (
            ChangeOrderSnapshot.objects.filter(change_order__project=project)
            .select_related("change_order")
            .order_by("-created_at", "-id")
        ):
            change_order = snapshot.change_order
            items.append({
                "timeline_id": f"co-snapshot-{snapshot.id}",
                "category": "workflow",
                "event_type": "change_order_decision",
                "occurred_at": snapshot.created_at,
                "label": f"CO {change_order.family_key} {snapshot.decision_status}",
                "detail": "",
                "object_type": "change_order",
                "object_id": change_order.id,
                "ui_route": f"/projects/{project.id}/change-orders?co={change_order.id}",
            })

    # --- Financial events ---
    if category in {"all", "financial"}:
        for record in (
            PaymentRecord.objects.filter(payment__project=project)
            .select_related("payment")
            .order_by("-created_at", "-id")
        ):
            payment = record.payment
            label_parts = [f"Payment #{payment.id} {record.event_type}"]
            if record.from_status and record.to_status:
                label_parts.append(f"({record.from_status} → {record.to_status})")
            items.append({
                "timeline_id": f"payment-record-{record.id}",
                "category": "financial",
                "event_type": "payment_record",
                "occurred_at": record.created_at,
                "label": " ".join(label_parts),
                "detail": record.note or "",
                "object_type": "payment",
                "object_id": payment.id,
                "ui_route": "/payments",
            })

        for snapshot in (
            VendorBillSnapshot.objects.filter(vendor_bill__project=project)
            .select_related("vendor_bill")
            .order_by("-created_at", "-id")
        ):
            vendor_bill = snapshot.vendor_bill
            items.append({
                "timeline_id": f"vb-snapshot-{snapshot.id}",
                "category": "financial",
                "event_type": "vendor_bill_status",
                "occurred_at": snapshot.created_at,
                "label": f"Vendor Bill #{vendor_bill.id} {snapshot.capture_status}",
                "detail": "",
                "object_type": "vendor_bill",
                "object_id": vendor_bill.id,
                "ui_route": "/bills",
            })

    sorted_items = sorted(items, key=lambda item: item["occurred_at"], reverse=True)
    payload = {
        "project_id": project.id,
        "project_name": project.name,
        "category": category,
        "item_count": len(sorted_items),
        "items": sorted_items,
    }
    return Response({"data": ProjectTimelineSerializer(payload).data})
