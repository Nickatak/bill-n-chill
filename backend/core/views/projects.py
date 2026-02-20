import csv
from datetime import datetime, timezone
from decimal import Decimal
from io import StringIO

from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import ChangeOrder, FinancialAuditEvent, Invoice, Payment, PaymentAllocation, Project, VendorBill
from core.serializers import (
    FinancialAuditEventSerializer,
    ProjectFinancialSummarySerializer,
    ProjectProfileSerializer,
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
