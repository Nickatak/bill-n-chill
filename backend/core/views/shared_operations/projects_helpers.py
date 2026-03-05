"""Domain-specific helpers for project views."""

from datetime import date
from decimal import Decimal

from core.models import (
    Budget,
    ChangeOrder,
    Invoice,
    Payment,
    PaymentAllocation,
    Project,
    VendorBill,
)
from core.views.helpers import _organization_user_ids


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


def _project_active_budget_map(*, project_ids, actor_user_ids):
    if not project_ids:
        return {}

    active_budgets = (
        Budget.objects.filter(
            project_id__in=project_ids,
            created_by_id__in=actor_user_ids,
            status=Budget.Status.ACTIVE,
        )
        .select_related("source_estimate")
        .order_by("project_id", "-created_at", "-id")
    )
    active_budget_by_project: dict[int, Budget] = {}
    for budget in active_budgets:
        if budget.project_id in active_budget_by_project:
            continue
        active_budget_by_project[budget.project_id] = budget
    return active_budget_by_project


def _project_accepted_contract_totals_map(*, project_ids, actor_user_ids):
    active_budget_by_project = _project_active_budget_map(
        project_ids=project_ids,
        actor_user_ids=actor_user_ids,
    )
    totals: dict[int, Decimal] = {}
    for project_id, budget in active_budget_by_project.items():
        if not budget.source_estimate_id:
            totals[project_id] = Decimal("0")
            continue
        totals[project_id] = budget.source_estimate.grand_total + budget.approved_change_order_total
    return totals


def _build_project_financial_summary_data(project: Project, user, *, actor_user_ids=None):
    if actor_user_ids is None:
        actor_user_ids = _organization_user_ids(user)

    active_budget = _project_active_budget_map(
        project_ids=[project.id],
        actor_user_ids=actor_user_ids,
    ).get(project.id)
    if active_budget and active_budget.source_estimate_id:
        accepted_contract_total = (
            active_budget.source_estimate.grand_total + active_budget.approved_change_order_total
        )
    else:
        accepted_contract_total = Decimal("0")

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
            created_by_id__in=actor_user_ids,
        )
        .exclude(status=Invoice.Status.VOID)
        .order_by("-created_at", "-id")
    )
    invoiced_to_date = sum((invoice.total for invoice in invoice_rows), Decimal("0"))

    inbound_alloc_rows = list(
        PaymentAllocation.objects.filter(
            payment__project=project,
            payment__created_by_id__in=actor_user_ids,
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
            created_by_id__in=actor_user_ids,
        )
        .exclude(status=VendorBill.Status.VOID)
        .order_by("-created_at", "-id")
    )
    ap_total = sum((bill.total for bill in vendor_bill_rows), Decimal("0"))

    outbound_alloc_rows = list(
        PaymentAllocation.objects.filter(
            payment__project=project,
            payment__created_by_id__in=actor_user_ids,
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
            created_by_id__in=actor_user_ids,
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
            created_by_id__in=actor_user_ids,
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
                    "label": f"CO-{row.family_key}",
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
            "ui_route": f"/financials-auditing?project={project.id}",
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
            "ui_route": f"/financials-auditing?project={project.id}",
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
        "accepted_contract_total": accepted_contract_total,
        "active_budget_id": active_budget.id if active_budget else None,
        "active_budget_source_estimate_id": active_budget.source_estimate_id if active_budget else None,
        "active_budget_source_estimate_version": (
            active_budget.source_estimate.version
            if active_budget and active_budget.source_estimate_id
            else None
        ),
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
