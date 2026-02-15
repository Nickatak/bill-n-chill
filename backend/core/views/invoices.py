from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import FinancialAuditEvent, Invoice
from core.serializers import InvoiceScopeOverrideSerializer, InvoiceSerializer, InvoiceWriteSerializer
from core.views.helpers import (
    _apply_invoice_lines_and_totals,
    _calculate_invoice_line_totals,
    _enforce_invoice_scope_guard,
    _is_billable_invoice_status,
    _next_invoice_number,
    _resolve_invoice_cost_codes_for_user,
    _record_financial_audit_event,
    _validate_invoice_status_transition,
    _validate_project_for_user,
)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_invoices_view(request, project_id: int):
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            Invoice.objects.filter(project=project, created_by=request.user)
            .select_related("customer")
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("-created_at")
        )
        return Response({"data": InvoiceSerializer(rows, many=True).data})

    serializer = InvoiceWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    line_items = data.get("line_items", [])
    if not line_items:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one invoice line item is required.",
                    "fields": {"line_items": ["At least one line item is required."]},
                }
            },
            status=400,
        )

    issue_date = data.get("issue_date") or timezone.localdate()
    due_date = data.get("due_date") or (issue_date + timedelta(days=30))
    if due_date < issue_date:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "due_date cannot be before issue_date.",
                    "fields": {"due_date": ["Due date must be on or after issue date."]},
                }
            },
            status=400,
        )

    invoice = Invoice.objects.create(
        project=project,
        customer=project.customer,
        invoice_number=_next_invoice_number(project=project, user=request.user),
        status=Invoice.Status.DRAFT,
        issue_date=issue_date,
        due_date=due_date,
        tax_percent=data.get("tax_percent", Decimal("0")),
        created_by=request.user,
    )

    apply_error = _apply_invoice_lines_and_totals(
        invoice=invoice,
        line_items_data=line_items,
        tax_percent=data.get("tax_percent", Decimal("0")),
        user=request.user,
    )
    if apply_error:
        invoice.delete()
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

    invoice.refresh_from_db()
    _record_financial_audit_event(
        project=project,
        event_type=FinancialAuditEvent.EventType.INVOICE_UPDATED,
        object_type="invoice",
        object_id=invoice.id,
        from_status="",
        to_status=Invoice.Status.DRAFT,
        amount=invoice.total,
        note="Invoice created.",
        created_by=request.user,
        metadata={"invoice_number": invoice.invoice_number},
    )
    return Response({"data": InvoiceSerializer(invoice).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def invoice_detail_view(request, invoice_id: int):
    try:
        invoice = Invoice.objects.select_related("customer").get(
            id=invoice_id,
            created_by=request.user,
        )
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": InvoiceSerializer(invoice).data})

    serializer = InvoiceWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    scope_override = data.get("scope_override", False)
    scope_override_note = data.get("scope_override_note", "")

    status_changing = "status" in data
    previous_status = invoice.status
    next_status = data.get("status", invoice.status)
    if status_changing and not _validate_invoice_status_transition(
        current_status=invoice.status,
        next_status=next_status,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid invoice status transition: {invoice.status} -> {next_status}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    next_issue_date = data.get("issue_date", invoice.issue_date)
    next_due_date = data.get("due_date", invoice.due_date)
    if next_due_date < next_issue_date:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "due_date cannot be before issue_date.",
                    "fields": {"due_date": ["Due date must be on or after issue date."]},
                }
            },
            status=400,
        )

    totals_changing = "line_items" in data or "tax_percent" in data
    candidate_total = invoice.total
    if "line_items" in data:
        line_items = data["line_items"]
        if not line_items:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "At least one invoice line item is required.",
                        "fields": {"line_items": ["At least one line item is required."]},
                    }
                },
                status=400,
            )
        _, missing_cost_codes = _resolve_invoice_cost_codes_for_user(request.user, line_items)
        if missing_cost_codes:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "One or more cost codes are invalid for this user.",
                        "fields": {"cost_code": missing_cost_codes},
                    }
                },
                status=400,
            )
        line_items_for_preview = line_items
    else:
        line_items_for_preview = [
            {
                "cost_code": line.cost_code_id,
                "description": line.description,
                "quantity": line.quantity,
                "unit": line.unit,
                "unit_price": line.unit_price,
            }
            for line in invoice.line_items.all()
        ]

    if totals_changing:
        _, candidate_subtotal = _calculate_invoice_line_totals(line_items_for_preview)
        candidate_tax_percent = Decimal(str(data.get("tax_percent", invoice.tax_percent)))
        candidate_tax_total = candidate_subtotal * (candidate_tax_percent / Decimal("100"))
        candidate_total = candidate_subtotal + candidate_tax_total

    status_is_entering_billable = _is_billable_invoice_status(next_status) and not _is_billable_invoice_status(
        invoice.status
    )
    scope_guard_required = status_is_entering_billable or (
        totals_changing and _is_billable_invoice_status(next_status)
    )

    with transaction.atomic():
        if scope_guard_required:
            scope_error = _enforce_invoice_scope_guard(
                invoice=invoice,
                project=invoice.project,
                user=request.user,
                candidate_status=next_status,
                candidate_total=candidate_total,
                scope_override=scope_override,
                scope_override_note=scope_override_note,
            )
            if scope_error:
                return Response(scope_error, status=400)

        update_fields = ["updated_at"]
        if "issue_date" in data:
            invoice.issue_date = data["issue_date"]
            update_fields.append("issue_date")
        if "due_date" in data:
            invoice.due_date = data["due_date"]
            update_fields.append("due_date")
        if "status" in data:
            invoice.status = data["status"]
            update_fields.append("status")
        if "tax_percent" in data:
            invoice.tax_percent = data["tax_percent"]
            update_fields.append("tax_percent")
        if len(update_fields) > 1:
            invoice.save(update_fields=update_fields)

        if "line_items" in data:
            apply_error = _apply_invoice_lines_and_totals(
                invoice=invoice,
                line_items_data=data["line_items"],
                tax_percent=data.get("tax_percent", invoice.tax_percent),
                user=request.user,
            )
            if apply_error:
                transaction.set_rollback(True)
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
            existing_lines = [
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit": line.unit,
                    "unit_price": line.unit_price,
                }
                for line in invoice.line_items.all()
            ]
            _apply_invoice_lines_and_totals(
                invoice=invoice,
                line_items_data=existing_lines,
                tax_percent=invoice.tax_percent,
                user=request.user,
            )
        elif status_changing:
            invoice.balance_due = (
                Decimal("0") if invoice.status == Invoice.Status.PAID else invoice.total
            )
            invoice.save(update_fields=["balance_due", "updated_at"])

        if previous_status != next_status or totals_changing:
            _record_financial_audit_event(
                project=invoice.project,
                event_type=FinancialAuditEvent.EventType.INVOICE_UPDATED,
                object_type="invoice",
                object_id=invoice.id,
                from_status=previous_status,
                to_status=next_status,
                amount=candidate_total if totals_changing else invoice.total,
                note="Invoice updated.",
                created_by=request.user,
                metadata={
                    "invoice_number": invoice.invoice_number,
                    "totals_changed": totals_changing,
                    "status_changed": previous_status != next_status,
                },
            )

    invoice.refresh_from_db()
    return Response({"data": InvoiceSerializer(invoice).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def invoice_send_view(request, invoice_id: int):
    try:
        invoice = Invoice.objects.get(id=invoice_id, created_by=request.user)
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    if not _validate_invoice_status_transition(
        current_status=invoice.status,
        next_status=Invoice.Status.SENT,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid invoice status transition: {invoice.status} -> sent.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    override_serializer = InvoiceScopeOverrideSerializer(data=request.data)
    override_serializer.is_valid(raise_exception=True)
    override_data = override_serializer.validated_data

    with transaction.atomic():
        previous_status = invoice.status
        scope_error = _enforce_invoice_scope_guard(
            invoice=invoice,
            project=invoice.project,
            user=request.user,
            candidate_status=Invoice.Status.SENT,
            candidate_total=invoice.total,
            scope_override=override_data.get("scope_override", False),
            scope_override_note=override_data.get("scope_override_note", ""),
        )
        if scope_error:
            return Response(scope_error, status=400)

        invoice.status = Invoice.Status.SENT
        invoice.save(update_fields=["status", "updated_at"])
        _record_financial_audit_event(
            project=invoice.project,
            event_type=FinancialAuditEvent.EventType.INVOICE_UPDATED,
            object_type="invoice",
            object_id=invoice.id,
            from_status=previous_status,
            to_status=Invoice.Status.SENT,
            amount=invoice.total,
            note="Invoice sent.",
            created_by=request.user,
            metadata={"invoice_number": invoice.invoice_number},
        )

    return Response({"data": InvoiceSerializer(invoice).data})
