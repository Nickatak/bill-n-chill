"""Accounts receivable invoice endpoints and state transitions."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import FinancialAuditEvent, Invoice, InvoiceStatusEvent
from core.policies import get_invoice_policy_contract
from core.serializers import (
    InvoiceScopeOverrideSerializer,
    InvoiceSerializer,
    InvoiceStatusEventSerializer,
    InvoiceWriteSerializer,
)
from core.utils.money import quantize_money
from core.views.accounts_receivable.invoice_ingress import (
    build_invoice_create_ingress,
    build_invoice_patch_ingress,
)
from core.views.helpers import (
    _apply_invoice_lines_and_totals,
    _calculate_invoice_line_totals,
    _ensure_primary_membership,
    _enforce_invoice_scope_guard,
    _is_billable_invoice_status,
    _next_invoice_number,
    _organization_user_ids,
    _resolve_invoice_cost_codes_for_user,
    _record_financial_audit_event,
    _record_invoice_status_event,
    _role_gate_error_payload,
    _validate_project_for_user,
)


def _invoice_line_apply_error_response(apply_error):
    if "missing_budget_lines" in apply_error:
        return (
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more budget lines are invalid for this project's active budget.",
                    "fields": {"budget_line": apply_error["missing_budget_lines"]},
                }
            },
            400,
        )
    if "missing_cost_codes" in apply_error:
        return (
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more cost codes are invalid for this user.",
                    "fields": {"cost_code": apply_error["missing_cost_codes"]},
                }
            },
            400,
        )
    if "missing_scope_items" in apply_error:
        return (
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more scope items are invalid for this user.",
                    "fields": {"scope_item": apply_error["missing_scope_items"]},
                }
            },
            400,
        )
    if "invalid_lines" in apply_error:
        return (
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more invoice lines are invalid.",
                    "fields": {"line_items": apply_error["invalid_lines"]},
                }
            },
            400,
        )
    return (
        {
            "error": {
                "code": "validation_error",
                "message": "Invoice line validation failed.",
                "fields": {},
            }
        },
        400,
    )


def _build_public_invoice_decision_note(
    *,
    action_label: str,
    note: str,
    decider_name: str,
    decider_email: str,
) -> str:
    actor_parts = [part for part in [decider_name.strip(), decider_email.strip()] if part]
    actor_label = " / ".join(actor_parts) if actor_parts else "anonymous customer"
    note_value = note.strip()
    if note_value:
        return f"{action_label} via public link by {actor_label}. {note_value}"
    return f"{action_label} via public link by {actor_label}."


@api_view(["GET"])
@permission_classes([AllowAny])
def public_invoice_detail_view(request, public_token: str):
    """Return public invoice detail for share links, including lightweight project context."""
    try:
        invoice = (
            Invoice.objects.select_related("project__customer")
            .prefetch_related(
                "line_items",
                "line_items__budget_line",
                "line_items__budget_line__cost_code",
                "line_items__cost_code",
                "line_items__scope_item",
            )
            .get(public_token=public_token)
        )
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    serialized = InvoiceSerializer(invoice).data
    serialized["project_context"] = {
        "id": invoice.project.id,
        "name": invoice.project.name,
        "status": invoice.project.status,
        "customer_display_name": invoice.project.customer.display_name,
        "customer_billing_address": invoice.project.customer.billing_address,
    }
    return Response({"data": serialized})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_invoice_decision_view(request, public_token: str):
    """Apply customer approval/dispute decision to a public invoice share link."""
    try:
        invoice = (
            Invoice.objects.select_related("project", "project__customer", "created_by")
            .prefetch_related(
                "line_items",
                "line_items__budget_line",
                "line_items__budget_line__cost_code",
                "line_items__cost_code",
                "line_items__scope_item",
            )
            .get(public_token=public_token)
        )
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    current_status = invoice.status
    if current_status not in {
        Invoice.Status.SENT,
        Invoice.Status.PARTIALLY_PAID,
        Invoice.Status.OVERDUE,
    }:
        return Response(
            {
                "error": {
                    "code": "conflict",
                    "message": "This invoice is not awaiting customer decision.",
                    "fields": {"status": [f"Current status is '{current_status}'."]},
                }
            },
            status=409,
        )

    decision = str(request.data.get("decision", "")).strip().lower()
    decision_type = None
    if decision in {"approve", "approved", "pay", "paid"}:
        decision_type = "approve"
    elif decision in {"dispute", "disputed", "reject", "rejected"}:
        decision_type = "dispute"

    if not decision_type:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid public decision for invoice.",
                    "fields": {"decision": ["Use 'approve'/'pay' or 'dispute'."]},
                }
            },
            status=400,
        )

    decider_name = str(request.data.get("decider_name", "") or "")
    decider_email = str(request.data.get("decider_email", "") or "")
    public_note = _build_public_invoice_decision_note(
        action_label="Approved for payment" if decision_type == "approve" else "Disputed",
        note=str(request.data.get("note", "") or ""),
        decider_name=decider_name,
        decider_email=decider_email,
    )

    with transaction.atomic():
        previous_status = invoice.status
        if decision_type == "approve":
            if not Invoice.is_transition_allowed(previous_status, Invoice.Status.PAID):
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": f"Invalid invoice status transition: {previous_status} -> paid.",
                            "fields": {"status": ["This transition is not allowed."]},
                        }
                    },
                    status=400,
                )
            invoice.status = Invoice.Status.PAID
            invoice.save(update_fields=["status", "updated_at"])
            _record_invoice_status_event(
                invoice=invoice,
                from_status=previous_status,
                to_status=invoice.status,
                note=public_note,
                changed_by=invoice.created_by,
            )
            _record_financial_audit_event(
                project=invoice.project,
                event_type=FinancialAuditEvent.EventType.INVOICE_UPDATED,
                object_type="invoice",
                object_id=invoice.id,
                from_status=previous_status,
                to_status=invoice.status,
                amount=invoice.total,
                note=public_note,
                created_by=invoice.created_by,
                metadata={
                    "invoice_number": invoice.invoice_number,
                    "public_decision": True,
                    "public_decision_value": decision,
                    "status_action": "transition",
                },
            )
        else:
            _record_invoice_status_event(
                invoice=invoice,
                from_status=previous_status,
                to_status=previous_status,
                note=public_note,
                changed_by=invoice.created_by,
            )
            _record_financial_audit_event(
                project=invoice.project,
                event_type=FinancialAuditEvent.EventType.INVOICE_UPDATED,
                object_type="invoice",
                object_id=invoice.id,
                from_status=previous_status,
                to_status=previous_status,
                amount=invoice.total,
                note=public_note,
                created_by=invoice.created_by,
                metadata={
                    "invoice_number": invoice.invoice_number,
                    "public_decision": True,
                    "public_decision_value": decision,
                    "status_action": "notate",
                },
            )

    refreshed = (
        Invoice.objects.filter(id=invoice.id)
        .select_related("project__customer")
        .prefetch_related(
            "line_items",
            "line_items__budget_line",
            "line_items__budget_line__cost_code",
            "line_items__cost_code",
            "line_items__scope_item",
        )
        .get()
    )
    serialized = InvoiceSerializer(refreshed).data
    serialized["project_context"] = {
        "id": refreshed.project.id,
        "name": refreshed.project.name,
        "status": refreshed.project.status,
        "customer_display_name": refreshed.project.customer.display_name,
        "customer_billing_address": refreshed.project.customer.billing_address,
    }
    return Response({"data": serialized, "meta": {"public_decision_applied": decision_type}})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_contract_view(_request):
    """Return canonical invoice workflow policy for frontend UX guards."""
    return Response({"data": get_invoice_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_invoices_view(request, project_id: int):
    """Project invoice collection endpoint: `GET` lists invoices, `POST` creates a draft with audit trail.

    Contract:
    - `GET` (user/project-scoped list):
      - `200`: invoice list returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `POST` (requires role `owner|pm|bookkeeping`):
      - `201`: draft invoice created and returned.
        - Guarantees:
          - newly created invoice status is `draft`. `[APP]`
          - newly created invoice satisfies `due_date >= issue_date`. `[DB+APP]`
          - newly created invoice totals and balance are recalculated from canonical line items + tax. `[APP]`
          - newly created invoice number remains unique per project. `[DB+APP]`
      - `400`: validation or business-rule failure.
        - Guarantees:
          - no durable partial mutation from the failed request (atomic rollback). `[DB+APP]`
      - `403`: role gate denied for create.
        - Guarantees: no object mutations. `[APP]`
      - `404`: project not found for this user.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - project must resolve through user scope (`_validate_project_for_user`).
      - `POST` requires effective role in `owner|pm|bookkeeping`.

    - Object mutations:
      - `GET`: none.
      - `POST`:
        - Creates:
          - Standard: `Invoice`, `InvoiceLine` rows.
          - Audit: `InvoiceStatusEvent`, `FinancialAuditEvent`.
        - Edits:
          - Standard: computed invoice totals/balance fields.
          - Audit: none.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - requires `line_items` with at least 1 row.
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "issue_date": "YYYY-MM-DD (optional, default=today)",
          "due_date": "YYYY-MM-DD (optional, must be >= issue_date, default=issue_date+30d)",
          "tax_percent": "decimal (optional, default=0)",
          "_comment_line_items_requirement": "line_items is required and must include at least 1 row",
          "line_items": [
            {
              "line_type": "scope|adjustment (optional, default=scope)",
              "cost_code": "integer|null (optional)",
              "scope_item": "integer|null (optional)",
              "adjustment_reason": "string (required when line_type=adjustment)",
              "internal_note": "string (optional)",
              "description": "string (required)",
              "quantity": "decimal (required)",
              "unit": "string (optional, default=ea)",
              "unit_price": "decimal (required)"
            }
          ]
        }

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.
      - `POST` is not idempotent; each successful retry creates another invoice.
      - failed `POST` writes are rolled back atomically (no partial invoice/line/event persistence).

    - Test anchors:
      - `backend/core/tests/test_invoices.py::test_project_invoices_list_scoped_by_project_and_user`
      - `backend/core/tests/test_invoices.py::test_invoice_create_calculates_totals_and_lines`
      - `backend/core/tests/test_invoices.py::test_invoice_create_rolls_back_when_status_event_write_fails`
    """
    actor_user_ids = _organization_user_ids(request.user)
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            Invoice.objects.filter(project=project, created_by_id__in=actor_user_ids)
            .select_related("customer")
            .prefetch_related(
                "line_items",
                "line_items__budget_line",
                "line_items__budget_line__cost_code",
                "line_items__cost_code",
                "line_items__scope_item",
            )
            .order_by("-created_at")
        )
        return Response({"data": InvoiceSerializer(rows, many=True).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = InvoiceWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    membership = _ensure_primary_membership(request.user)
    organization = membership.organization
    default_due_days = int(organization.invoice_default_due_days or 30)
    default_due_days = max(1, min(default_due_days, 365))
    ingress = build_invoice_create_ingress(
        serializer.validated_data,
        default_issue_date=timezone.localdate(),
        default_due_days=default_due_days,
        default_sender_name=(organization.invoice_sender_name or organization.display_name or "").strip(),
        default_sender_email=(organization.invoice_sender_email or "").strip(),
        default_sender_address=(organization.invoice_sender_address or "").strip(),
        default_sender_logo_url=(organization.logo_url or "").strip(),
        default_terms_text=(organization.invoice_default_terms or "").strip(),
        default_footer_text=(organization.invoice_default_footer or "").strip(),
        default_notes_text=(organization.invoice_default_notes or "").strip(),
    )
    line_items = ingress.line_items
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

    issue_date = ingress.issue_date
    due_date = ingress.due_date
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

    with transaction.atomic():
        invoice = Invoice.objects.create(
            project=project,
            customer=project.customer,
            invoice_number=_next_invoice_number(project=project, user=request.user),
            status=Invoice.Status.DRAFT,
            issue_date=issue_date,
            due_date=due_date,
            sender_name=ingress.sender_name,
            sender_email=ingress.sender_email,
            sender_address=ingress.sender_address,
            sender_logo_url=ingress.sender_logo_url,
            terms_text=ingress.terms_text,
            footer_text=ingress.footer_text,
            notes_text=ingress.notes_text,
            tax_percent=ingress.tax_percent,
            created_by=request.user,
        )

        apply_error = _apply_invoice_lines_and_totals(
            invoice=invoice,
            line_items_data=line_items,
            tax_percent=ingress.tax_percent,
            user=request.user,
        )
        if apply_error:
            transaction.set_rollback(True)
            payload, status_code = _invoice_line_apply_error_response(apply_error)
            return Response(payload, status=status_code)

        invoice.refresh_from_db()
        _record_invoice_status_event(
            invoice=invoice,
            from_status=None,
            to_status=invoice.status,
            note="Invoice created.",
            changed_by=request.user,
        )
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
    """Fetch or update one invoice while enforcing lifecycle, totals, and scope-guard rules.

    Contract:
    - `GET`:
      - `200`: invoice detail returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: invoice not found for this user.
        - Guarantees: no object mutations. `[APP]`
    - `PATCH` (requires role `owner|pm|bookkeeping`):
      - `200`: patch applied and updated invoice returned.
        - Guarantees:
          - updated invoice satisfies lifecycle/date invariants. `[DB+APP]`
          - invoice totals/balance remain consistent with stored lines and tax settings. `[APP]`
      - `400`: validation, transition, scope-guard, or line/totals failure.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for patch.
        - Guarantees: no object mutations. `[APP]`
      - `404`: invoice not found for this user.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - invoice must belong to requesting user.
      - `PATCH` requires effective role in `owner|pm|bookkeeping`.

    - Object mutations:
      - `GET`: none.
      - `PATCH`:
        - Creates:
          - Standard: `InvoiceLine` replacement rows (when `line_items` is provided).
          - Audit: `InvoiceStatusEvent`, `FinancialAuditEvent`, and `InvoiceScopeOverrideEvent` when applicable.
        - Edits:
          - Standard: `Invoice` fields (`status`, dates, tax/totals, balance).
          - Audit: none.
        - Deletes: existing `InvoiceLine` rows when replacing line items.

    - Incoming payload (`PATCH`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "status": "draft|sent|partially_paid|paid|overdue|void (optional)",
          "issue_date": "YYYY-MM-DD (optional)",
          "due_date": "YYYY-MM-DD (optional, must be >= issue_date)",
          "tax_percent": "decimal (optional)",
          "_comment_line_items": "if present, line_items must include at least 1 row",
          "line_items": [
            {
              "line_type": "scope|adjustment (optional, default=scope)",
              "cost_code": "integer|null (optional)",
              "scope_item": "integer|null (optional)",
              "adjustment_reason": "string (required when line_type=adjustment)",
              "internal_note": "string (optional)",
              "description": "string (required)",
              "quantity": "decimal (required)",
              "unit": "string (optional, default=ea)",
              "unit_price": "decimal (required)"
            }
          ],
          "scope_override": "boolean (optional)",
          "scope_override_note": "string (required when scope override is needed)"
        }

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.
      - `PATCH` is conditionally idempotent when payload values equal current persisted values.
      - `PATCH` retries that fail validation do not persist partial writes.

    - Test anchors:
      - `backend/core/tests/test_invoices.py::test_invoice_status_transition_validation_and_paid_balance`
      - `backend/core/tests/test_invoices.py::test_invoice_patch_line_items_recalculates_totals`
      - `backend/core/tests/test_invoices.py::test_invoice_patch_billable_totals_over_scope_requires_override`
    """
    actor_user_ids = _organization_user_ids(request.user)
    try:
        invoice = (
            Invoice.objects.select_related("customer")
            .prefetch_related(
                "line_items",
                "line_items__budget_line",
                "line_items__budget_line__cost_code",
                "line_items__cost_code",
                "line_items__scope_item",
            )
            .get(
                id=invoice_id,
                created_by_id__in=actor_user_ids,
            )
        )
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": InvoiceSerializer(invoice).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    serializer = InvoiceWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    ingress = build_invoice_patch_ingress(serializer.validated_data)
    scope_override = ingress.scope_override
    scope_override_note = ingress.scope_override_note
    status_note = ingress.status_note

    status_changing = ingress.has_status
    status_note_requested = ingress.has_status_note and bool(status_note.strip())
    previous_status = invoice.status
    next_status = ingress.status if ingress.has_status else invoice.status
    is_resend = (
        status_changing
        and previous_status == Invoice.Status.SENT
        and next_status == Invoice.Status.SENT
    )
    same_status_note_request = (
        status_changing
        and previous_status == next_status
        and status_note_requested
    )
    if status_changing and not (is_resend or same_status_note_request) and not Invoice.is_transition_allowed(
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

    next_issue_date = ingress.issue_date if ingress.has_issue_date else invoice.issue_date
    next_due_date = ingress.due_date if ingress.has_due_date else invoice.due_date
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

    totals_changing = ingress.has_line_items or ingress.has_tax_percent
    template_changing = any(
        [
            ingress.has_sender_name,
            ingress.has_sender_email,
            ingress.has_sender_address,
            ingress.has_sender_logo_url,
            ingress.has_terms_text,
            ingress.has_footer_text,
            ingress.has_notes_text,
        ]
    )
    candidate_total = invoice.total
    if ingress.has_line_items:
        line_items = ingress.line_items
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
                "line_type": line.line_type,
                "budget_line": line.budget_line_id,
                "cost_code": line.cost_code_id,
                "scope_item": line.scope_item_id,
                "adjustment_reason": line.adjustment_reason,
                "internal_note": line.internal_note,
                "description": line.description,
                "quantity": line.quantity,
                "unit": line.unit,
                "unit_price": line.unit_price,
            }
            for line in invoice.line_items.all()
        ]

    if totals_changing:
        _, candidate_subtotal = _calculate_invoice_line_totals(line_items_for_preview)
        candidate_tax_percent = Decimal(
            str(ingress.tax_percent if ingress.has_tax_percent else invoice.tax_percent)
        )
        candidate_tax_total = quantize_money(candidate_subtotal * (candidate_tax_percent / Decimal("100")))
        candidate_total = quantize_money(candidate_subtotal + candidate_tax_total)

    status_is_entering_billable = _is_billable_invoice_status(next_status) and not _is_billable_invoice_status(
        invoice.status
    )
    scope_guard_required = status_is_entering_billable or (
        totals_changing and _is_billable_invoice_status(next_status)
    )

    with transaction.atomic():
        scope_error = None
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
        if ingress.has_issue_date:
            invoice.issue_date = ingress.issue_date
            update_fields.append("issue_date")
        if ingress.has_due_date:
            invoice.due_date = ingress.due_date
            update_fields.append("due_date")
        if ingress.has_status:
            invoice.status = ingress.status
            update_fields.append("status")
        if ingress.has_tax_percent:
            invoice.tax_percent = ingress.tax_percent
            update_fields.append("tax_percent")
        if ingress.has_sender_name:
            invoice.sender_name = (ingress.sender_name or "").strip()
            update_fields.append("sender_name")
        if ingress.has_sender_email:
            invoice.sender_email = (ingress.sender_email or "").strip()
            update_fields.append("sender_email")
        if ingress.has_sender_address:
            invoice.sender_address = (ingress.sender_address or "").strip()
            update_fields.append("sender_address")
        if ingress.has_sender_logo_url:
            invoice.sender_logo_url = (ingress.sender_logo_url or "").strip()
            update_fields.append("sender_logo_url")
        if ingress.has_terms_text:
            invoice.terms_text = (ingress.terms_text or "").strip()
            update_fields.append("terms_text")
        if ingress.has_footer_text:
            invoice.footer_text = (ingress.footer_text or "").strip()
            update_fields.append("footer_text")
        if ingress.has_notes_text:
            invoice.notes_text = (ingress.notes_text or "").strip()
            update_fields.append("notes_text")
        if len(update_fields) > 1:
            invoice.save(update_fields=update_fields)

        if ingress.has_line_items:
            apply_error = _apply_invoice_lines_and_totals(
                invoice=invoice,
                line_items_data=ingress.line_items,
                tax_percent=ingress.tax_percent if ingress.has_tax_percent else invoice.tax_percent,
                user=request.user,
            )
            if apply_error:
                transaction.set_rollback(True)
                payload, status_code = _invoice_line_apply_error_response(apply_error)
                return Response(payload, status=status_code)
        elif ingress.has_tax_percent:
            existing_lines = [
                {
                    "line_type": line.line_type,
                    "budget_line": line.budget_line_id,
                    "cost_code": line.cost_code_id,
                    "scope_item": line.scope_item_id,
                    "adjustment_reason": line.adjustment_reason,
                    "internal_note": line.internal_note,
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

        should_record_status_event = previous_status != next_status or is_resend or status_note_requested
        if previous_status != next_status or totals_changing or template_changing or should_record_status_event:
            if should_record_status_event:
                status_event_note = status_note.strip()
                if not status_event_note:
                    status_event_note = "Invoice re-sent." if is_resend else "Invoice status updated."
                _record_invoice_status_event(
                    invoice=invoice,
                    from_status=previous_status,
                    to_status=next_status,
                    note=status_event_note,
                    changed_by=request.user,
                )
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
                    "status_note_logged": status_note_requested,
                    "template_changed": template_changing,
                },
            )

    invoice.refresh_from_db()
    return Response({"data": InvoiceSerializer(invoice).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def invoice_send_view(request, invoice_id: int):
    """Send an invoice by transitioning to `sent` with optional scope override metadata.

    Contract:
    - `POST` (requires role `owner|pm|bookkeeping`):
      - `200`: invoice transitioned to `sent` and returned.
        - Guarantees:
          - invoice status is `sent`. `[APP]`
          - send-path audit/status records are persisted. `[APP]`
      - `400`: transition invalid or scope-guard/override validation failed.
        - Guarantees: no durable partial mutation from failed request path. `[DB+APP]`
      - `403`: role gate denied for send.
        - Guarantees: no object mutations. `[APP]`
      - `404`: invoice not found for this user.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - invoice must belong to requesting user.
      - caller role must be `owner|pm|bookkeeping`.

    - Object mutations:
      - `POST`:
        - Creates:
          - Standard: none.
          - Audit: `InvoiceStatusEvent`, `FinancialAuditEvent`, and possibly `InvoiceScopeOverrideEvent`.
        - Edits:
          - Standard: `Invoice.status` (to `sent`).
          - Audit: none.
        - Deletes: none.

    - Incoming payload (`POST`) shape:
      - `_comment_*` keys in this example are documentation-only (not accepted API fields).
      - JSON map:
        {
          "scope_override": "boolean (optional)",
          "_comment_scope_override_note": "required when scope override is needed",
          "scope_override_note": "string (optional)"
        }

    - Idempotency and retry semantics:
      - `POST` is not idempotent for state transitions.
      - retries after success may fail transition validation if already `sent`.

    - Test anchors:
      - `backend/core/tests/test_invoices.py::test_invoice_send_endpoint_moves_draft_to_sent`
      - `backend/core/tests/test_invoices.py::test_invoice_send_blocks_when_total_exceeds_approved_scope_without_override`
      - `backend/core/tests/test_invoices.py::test_invoice_send_scope_override_creates_audit_note`
    """
    actor_user_ids = _organization_user_ids(request.user)
    try:
        invoice = Invoice.objects.get(id=invoice_id, created_by_id__in=actor_user_ids)
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "pm", "bookkeeping"})
    if permission_error:
        return Response(permission_error, status=403)

    if not Invoice.is_transition_allowed(
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
        _record_invoice_status_event(
            invoice=invoice,
            from_status=previous_status,
            to_status=Invoice.Status.SENT,
            note="Invoice sent.",
            changed_by=request.user,
        )
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_status_events_view(request, invoice_id: int):
    """Return immutable invoice status transition history for one invoice.

    Contract:
    - `GET`:
      - `200`: status-event list returned.
        - Guarantees: no object mutations. `[APP]`
      - `404`: invoice not found for this user.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller is authenticated (`IsAuthenticated`).
      - invoice must belong to requesting user.

    - Object mutations:
      - `GET`: none.

    - Idempotency and retry semantics:
      - `GET` is read-only and idempotent.

    - Test anchors:
      - `backend/core/tests/test_invoices.py::test_invoice_status_events_endpoint_returns_history`
    """
    actor_user_ids = _organization_user_ids(request.user)
    try:
        invoice = Invoice.objects.get(id=invoice_id, created_by_id__in=actor_user_ids)
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    events = InvoiceStatusEvent.objects.filter(invoice=invoice).select_related("changed_by")
    return Response({"data": InvoiceStatusEventSerializer(events, many=True).data})
