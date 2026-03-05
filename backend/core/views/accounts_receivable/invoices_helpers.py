"""Domain-specific helpers for invoice views."""

from decimal import Decimal

from django.db.models import Sum

from core.models import (
    Budget,
    BudgetLine,
    FinancialAuditEvent,
    Invoice,
    InvoiceLine,
    InvoiceScopeOverrideEvent,
    ScopeItem,
)
from core.user_helpers import _ensure_membership
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    SYSTEM_BUDGET_LINE_CODES,
    _organization_user_ids,
    _resolve_cost_codes_for_user,
)

BILLABLE_INVOICE_STATUSES = {
    Invoice.Status.SENT,
    Invoice.Status.PARTIALLY_PAID,
    Invoice.Status.PAID,
}


def _is_billable_invoice_status(status):
    """Return True if the invoice status counts toward billed totals."""
    return status in BILLABLE_INVOICE_STATUSES


def _project_billable_invoices_total(*, project, user, exclude_invoice_id=None):
    """Sum the totals of all billable invoices for a project, optionally excluding one."""
    actor_user_ids = _organization_user_ids(user)
    query = Invoice.objects.filter(
        project=project,
        created_by_id__in=actor_user_ids,
        status__in=BILLABLE_INVOICE_STATUSES,
    )
    if exclude_invoice_id:
        query = query.exclude(id=exclude_invoice_id)
    return quantize_money(query.aggregate(total=Sum("total")).get("total") or MONEY_ZERO)


def _enforce_invoice_scope_guard(
    *,
    invoice,
    project,
    user,
    candidate_status,
    candidate_total,
    scope_override,
    scope_override_note,
):
    """Check whether the invoice total exceeds the project's approved scope. Returns an error dict or None."""
    if not _is_billable_invoice_status(candidate_status):
        return None

    approved_scope_limit = project.contract_value_current
    already_billed = _project_billable_invoices_total(
        project=project,
        user=user,
        exclude_invoice_id=invoice.id,
    )
    projected_billed_total = quantize_money(already_billed + Decimal(str(candidate_total)))

    if projected_billed_total <= approved_scope_limit:
        return None

    overage_amount = quantize_money(projected_billed_total - approved_scope_limit)
    if not scope_override:
        return {
            "error": {
                "code": "validation_error",
                "message": "Invoice total exceeds approved billable scope for this project.",
                "fields": {
                    "scope_override": [
                        "Set scope_override=true with a note to allow this exception."
                    ]
                },
            },
            "meta": {
                "approved_scope_limit": str(approved_scope_limit),
                "already_billed_total": str(already_billed),
                "projected_billed_total": str(projected_billed_total),
                "overage_amount": str(overage_amount),
            },
        }

    note = (scope_override_note or "").strip()
    if not note:
        return {
            "error": {
                "code": "validation_error",
                "message": "scope_override_note is required when scope_override is true.",
                "fields": {
                    "scope_override_note": ["Provide a non-empty audit note for this override."]
                },
            }
        }

    InvoiceScopeOverrideEvent.objects.create(
        invoice=invoice,
        note=note,
        approved_scope_limit=approved_scope_limit,
        projected_billed_total=projected_billed_total,
        overage_amount=overage_amount,
        created_by=user,
    )
    FinancialAuditEvent.record(
        project=project,
        event_type=FinancialAuditEvent.EventType.INVOICE_SCOPE_OVERRIDE,
        object_type="invoice",
        object_id=invoice.id,
        from_status=invoice.status,
        to_status=candidate_status,
        amount=overage_amount,
        note=note,
        created_by=user,
        metadata={
            "approved_scope_limit": str(approved_scope_limit),
            "already_billed_total": str(already_billed),
            "projected_billed_total": str(projected_billed_total),
            "overage_amount": str(overage_amount),
        },
    )
    return None


def _next_invoice_number(*, project, user):
    """Generate the next unique sequential invoice number for a project."""
    actor_user_ids = _organization_user_ids(user)
    next_number = (
        Invoice.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
        ).count()
        + 1
    )
    candidate = f"INV-{next_number:04d}"
    while Invoice.objects.filter(project=project, invoice_number=candidate).exists():
        next_number += 1
        candidate = f"INV-{next_number:04d}"
    return candidate


def _calculate_invoice_line_totals(line_items_data):
    """Compute per-line totals and return normalized items with a running subtotal."""
    subtotal = MONEY_ZERO
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_price = Decimal(str(item["unit_price"]))
        line_total = quantize_money(quantity * unit_price)
        subtotal = quantize_money(subtotal + line_total)
        normalized_items.append(
            {
                **item,
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": line_total,
            }
        )

    return normalized_items, subtotal


def _resolve_invoice_scope_items_for_user(user, line_items_data):
    """Resolve and validate scope item IDs from line item data for the user's org."""
    ids = [item["scope_item"] for item in line_items_data if item.get("scope_item")]
    if not ids:
        return {}, []

    membership = _ensure_membership(user)
    rows = ScopeItem.objects.filter(id__in=ids, organization_id=membership.organization_id)
    item_map = {row.id: row for row in rows}
    missing = [scope_item_id for scope_item_id in ids if scope_item_id not in item_map]
    return item_map, missing


def _resolve_invoice_budget_lines_for_project(*, project, user, line_items_data):
    """Resolve and validate budget line IDs from the project's active budget."""
    ids = [item["budget_line"] for item in line_items_data if item.get("budget_line")]
    if not ids:
        return {}, []

    actor_user_ids = _organization_user_ids(user)
    rows = BudgetLine.objects.select_related("cost_code", "scope_item").filter(
        id__in=ids,
        budget__project=project,
        budget__created_by_id__in=actor_user_ids,
        budget__status=Budget.Status.ACTIVE,
    )
    line_map = {row.id: row for row in rows}
    missing = [line_id for line_id in ids if line_id not in line_map]
    return line_map, missing


def _apply_invoice_lines_and_totals(invoice, line_items_data, tax_percent, user):
    """Replace an invoice's line items and recompute all totals. Returns an error dict on failure."""
    normalized_items, subtotal = _calculate_invoice_line_totals(line_items_data)
    budget_line_map, missing_budget_lines = _resolve_invoice_budget_lines_for_project(
        project=invoice.project,
        user=user,
        line_items_data=normalized_items,
    )
    if missing_budget_lines:
        return {"missing_budget_lines": missing_budget_lines}
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}
    scope_item_map, missing_scope_items = _resolve_invoice_scope_items_for_user(
        user,
        normalized_items,
    )
    if missing_scope_items:
        return {"missing_scope_items": missing_scope_items}

    tax_percent = Decimal(str(tax_percent))
    tax_total = quantize_money(subtotal * (tax_percent / Decimal("100")))
    total = quantize_money(subtotal + tax_total)

    invoice.line_items.all().delete()
    new_lines = []
    invalid_lines = []
    for index, item in enumerate(normalized_items, start=1):
        line_type = item.get("line_type", InvoiceLine.LineType.SCOPE)
        adjustment_reason = (item.get("adjustment_reason") or "").strip()
        internal_note = (item.get("internal_note") or "").strip()
        budget_line_id = item.get("budget_line")
        budget_line = budget_line_map.get(budget_line_id) if budget_line_id else None
        cost_code_id = item.get("cost_code")
        cost_code = code_map.get(cost_code_id) if cost_code_id else None
        scope_item_id = item.get("scope_item")
        scope_item = scope_item_map.get(scope_item_id) if scope_item_id else None

        if line_type == InvoiceLine.LineType.SCOPE and not budget_line:
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "budget_line",
                    "message": "Scope lines require budget_line from the project's active budget.",
                }
            )
            continue
        if (
            line_type == InvoiceLine.LineType.SCOPE
            and budget_line
            and budget_line.cost_code
            and budget_line.cost_code.code in SYSTEM_BUDGET_LINE_CODES
        ):
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "budget_line",
                    "message": "Scope lines cannot use internal generic budget lines.",
                }
            )
            continue

        if line_type == InvoiceLine.LineType.ADJUSTMENT and not adjustment_reason:
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "adjustment_reason",
                    "message": "Adjustment lines require adjustment_reason.",
                }
            )
            continue

        if budget_line:
            if cost_code and budget_line.cost_code_id != cost_code.id:
                invalid_lines.append(
                    {
                        "line_index": index,
                        "field": "cost_code",
                        "message": "cost_code must match selected budget_line cost_code.",
                    }
                )
                continue
            if scope_item and budget_line.scope_item_id != scope_item.id:
                invalid_lines.append(
                    {
                        "line_index": index,
                        "field": "scope_item",
                        "message": "scope_item must match selected budget_line scope_item.",
                    }
                )
                continue
            cost_code = budget_line.cost_code
            scope_item = budget_line.scope_item

        if scope_item and cost_code and scope_item.cost_code_id != cost_code.id:
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "scope_item",
                    "message": "scope_item cost code must match the line cost_code when both are set.",
                }
            )
            continue

        new_lines.append(
            InvoiceLine(
                invoice=invoice,
                line_type=line_type,
                budget_line=budget_line,
                cost_code=cost_code,
                scope_item=scope_item,
                adjustment_reason=adjustment_reason,
                internal_note=internal_note,
                description=item["description"],
                quantity=item["quantity"],
                unit=item.get("unit", "ea"),
                unit_price=item["unit_price"],
                line_total=item["line_total"],
            )
        )

    if invalid_lines:
        return {"invalid_lines": invalid_lines}

    InvoiceLine.objects.bulk_create(new_lines)

    invoice.subtotal = subtotal
    invoice.tax_percent = tax_percent
    invoice.tax_total = tax_total
    invoice.total = total
    invoice.balance_due = MONEY_ZERO if invoice.status == Invoice.Status.PAID else total
    invoice.save(
        update_fields=[
            "subtotal",
            "tax_percent",
            "tax_total",
            "total",
            "balance_due",
            "updated_at",
        ]
    )
    return None


def _invoice_line_apply_error_response(apply_error):
    """Convert an _apply_invoice_lines_and_totals error dict into a (body, status) HTTP response tuple."""
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


