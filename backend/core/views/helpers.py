from decimal import Decimal

from django.db.models import Sum

from core.models import (
    Budget,
    BudgetLine,
    ChangeOrder,
    CostCode,
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    FinancialAuditEvent,
    Invoice,
    InvoiceLine,
    InvoiceScopeOverrideEvent,
    Payment,
    Project,
    VendorBill,
)

ALLOWED_ESTIMATE_STATUS_TRANSITIONS = {
    Estimate.Status.DRAFT: {
        Estimate.Status.SENT,
        Estimate.Status.APPROVED,
        Estimate.Status.ARCHIVED,
    },
    Estimate.Status.SENT: {
        Estimate.Status.DRAFT,
        Estimate.Status.APPROVED,
        Estimate.Status.REJECTED,
        Estimate.Status.ARCHIVED,
    },
    Estimate.Status.APPROVED: {Estimate.Status.ARCHIVED},
    Estimate.Status.REJECTED: {Estimate.Status.DRAFT, Estimate.Status.ARCHIVED},
    Estimate.Status.ARCHIVED: set(),
}

ALLOWED_CHANGE_ORDER_STATUS_TRANSITIONS = {
    ChangeOrder.Status.DRAFT: {
        ChangeOrder.Status.PENDING_APPROVAL,
        ChangeOrder.Status.VOID,
    },
    ChangeOrder.Status.PENDING_APPROVAL: {
        ChangeOrder.Status.DRAFT,
        ChangeOrder.Status.APPROVED,
        ChangeOrder.Status.REJECTED,
        ChangeOrder.Status.VOID,
    },
    ChangeOrder.Status.APPROVED: {ChangeOrder.Status.VOID},
    ChangeOrder.Status.REJECTED: {
        ChangeOrder.Status.DRAFT,
        ChangeOrder.Status.VOID,
    },
    ChangeOrder.Status.VOID: set(),
}

ALLOWED_INVOICE_STATUS_TRANSITIONS = {
    Invoice.Status.DRAFT: {Invoice.Status.SENT, Invoice.Status.VOID},
    Invoice.Status.SENT: {
        Invoice.Status.DRAFT,
        Invoice.Status.PARTIALLY_PAID,
        Invoice.Status.PAID,
        Invoice.Status.OVERDUE,
        Invoice.Status.VOID,
    },
    Invoice.Status.PARTIALLY_PAID: {
        Invoice.Status.PAID,
        Invoice.Status.OVERDUE,
        Invoice.Status.VOID,
    },
    Invoice.Status.PAID: {Invoice.Status.VOID},
    Invoice.Status.OVERDUE: {
        Invoice.Status.PARTIALLY_PAID,
        Invoice.Status.PAID,
        Invoice.Status.VOID,
    },
    Invoice.Status.VOID: set(),
}

ALLOWED_VENDOR_BILL_STATUS_TRANSITIONS = {
    VendorBill.Status.DRAFT: {
        VendorBill.Status.RECEIVED,
        VendorBill.Status.VOID,
    },
    VendorBill.Status.RECEIVED: {
        VendorBill.Status.DRAFT,
        VendorBill.Status.APPROVED,
        VendorBill.Status.VOID,
    },
    VendorBill.Status.APPROVED: {
        VendorBill.Status.SCHEDULED,
        VendorBill.Status.VOID,
    },
    VendorBill.Status.SCHEDULED: {
        VendorBill.Status.APPROVED,
        VendorBill.Status.PAID,
        VendorBill.Status.VOID,
    },
    VendorBill.Status.PAID: {
        VendorBill.Status.VOID,
    },
    VendorBill.Status.VOID: set(),
}

ALLOWED_PAYMENT_STATUS_TRANSITIONS = {
    Payment.Status.PENDING: {
        Payment.Status.SETTLED,
        Payment.Status.FAILED,
        Payment.Status.VOID,
    },
    Payment.Status.SETTLED: {
        Payment.Status.VOID,
    },
    Payment.Status.FAILED: {
        Payment.Status.PENDING,
        Payment.Status.VOID,
    },
    Payment.Status.VOID: set(),
}

BILLABLE_INVOICE_STATUSES = {
    Invoice.Status.SENT,
    Invoice.Status.PARTIALLY_PAID,
    Invoice.Status.PAID,
    Invoice.Status.OVERDUE,
}


def _validate_project_for_user(project_id: int, user):
    try:
        return Project.objects.select_related("customer").get(id=project_id, created_by=user)
    except Project.DoesNotExist:
        return None


def _calculate_line_totals(line_items_data):
    subtotal = Decimal("0")
    markup_total = Decimal("0")
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_cost = Decimal(str(item["unit_cost"]))
        markup_percent = Decimal(str(item.get("markup_percent", 0)))
        base_total = quantity * unit_cost
        line_markup = base_total * (markup_percent / Decimal("100"))
        line_total = base_total + line_markup
        subtotal += base_total
        markup_total += line_markup
        normalized_items.append(
            {
                **item,
                "quantity": quantity,
                "unit_cost": unit_cost,
                "markup_percent": markup_percent,
                "line_total": line_total,
            }
        )

    return normalized_items, subtotal, markup_total


def _resolve_cost_codes_for_user(user, line_items_data):
    ids = [item["cost_code"] for item in line_items_data]
    codes = CostCode.objects.filter(created_by=user, id__in=ids)
    code_map = {code.id: code for code in codes}
    missing = [cost_code_id for cost_code_id in ids if cost_code_id not in code_map]
    return code_map, missing


def _apply_estimate_lines_and_totals(estimate, line_items_data, tax_percent, user):
    normalized_items, subtotal, markup_total = _calculate_line_totals(line_items_data)
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_percent = Decimal(str(tax_percent))
    tax_total = (subtotal + markup_total) * (tax_percent / Decimal("100"))
    grand_total = subtotal + markup_total + tax_total

    estimate.line_items.all().delete()
    new_lines = []
    for item in normalized_items:
        new_lines.append(
            EstimateLineItem(
                estimate=estimate,
                cost_code=code_map[item["cost_code"]],
                description=item["description"],
                quantity=item["quantity"],
                unit=item.get("unit", "ea"),
                unit_cost=item["unit_cost"],
                markup_percent=item["markup_percent"],
                line_total=item["line_total"],
            )
        )
    EstimateLineItem.objects.bulk_create(new_lines)

    estimate.subtotal = subtotal
    estimate.markup_total = markup_total
    estimate.tax_percent = tax_percent
    estimate.tax_total = tax_total
    estimate.grand_total = grand_total
    estimate.save(
        update_fields=[
            "subtotal",
            "markup_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "updated_at",
        ]
    )
    return None


def _record_estimate_status_event(*, estimate, from_status, to_status, note, changed_by):
    EstimateStatusEvent.objects.create(
        estimate=estimate,
        from_status=from_status,
        to_status=to_status,
        note=note,
        changed_by=changed_by,
    )
    _record_financial_audit_event(
        project=estimate.project,
        event_type=FinancialAuditEvent.EventType.ESTIMATE_STATUS_CHANGED,
        object_type="estimate",
        object_id=estimate.id,
        from_status=from_status or "",
        to_status=to_status or "",
        note=note,
        created_by=changed_by,
        metadata={"version": estimate.version},
    )


def _record_financial_audit_event(
    *,
    project,
    event_type,
    object_type,
    object_id,
    created_by,
    from_status="",
    to_status="",
    amount=None,
    note="",
    metadata=None,
):
    FinancialAuditEvent.objects.create(
        project=project,
        event_type=event_type,
        object_type=object_type,
        object_id=object_id,
        from_status=from_status or "",
        to_status=to_status or "",
        amount=amount,
        note=note,
        metadata_json=metadata or {},
        created_by=created_by,
    )


def _validate_estimate_status_transition(*, current_status, next_status):
    if current_status == next_status:
        return True
    allowed = ALLOWED_ESTIMATE_STATUS_TRANSITIONS.get(current_status, set())
    return next_status in allowed


def _validate_change_order_status_transition(*, current_status, next_status):
    if current_status == next_status:
        return True
    allowed = ALLOWED_CHANGE_ORDER_STATUS_TRANSITIONS.get(current_status, set())
    return next_status in allowed


def _next_change_order_number(*, project):
    latest = ChangeOrder.objects.filter(project=project).order_by("-number").first()
    return (latest.number + 1) if latest else 1


def _validate_invoice_status_transition(*, current_status, next_status):
    if current_status == next_status:
        return True
    allowed = ALLOWED_INVOICE_STATUS_TRANSITIONS.get(current_status, set())
    return next_status in allowed


def _validate_vendor_bill_status_transition(*, current_status, next_status):
    if current_status == next_status:
        return True
    allowed = ALLOWED_VENDOR_BILL_STATUS_TRANSITIONS.get(current_status, set())
    return next_status in allowed


def _validate_payment_status_transition(*, current_status, next_status):
    if current_status == next_status:
        return True
    allowed = ALLOWED_PAYMENT_STATUS_TRANSITIONS.get(current_status, set())
    return next_status in allowed


def _is_billable_invoice_status(status):
    return status in BILLABLE_INVOICE_STATUSES


def _project_billable_invoices_total(*, project, user, exclude_invoice_id=None):
    query = Invoice.objects.filter(
        project=project,
        created_by=user,
        status__in=BILLABLE_INVOICE_STATUSES,
    )
    if exclude_invoice_id:
        query = query.exclude(id=exclude_invoice_id)
    return query.aggregate(total=Sum("total")).get("total") or Decimal("0")


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
    if not _is_billable_invoice_status(candidate_status):
        return None

    approved_scope_limit = project.contract_value_current
    already_billed = _project_billable_invoices_total(
        project=project,
        user=user,
        exclude_invoice_id=invoice.id,
    )
    projected_billed_total = already_billed + Decimal(str(candidate_total))

    if projected_billed_total <= approved_scope_limit:
        return None

    overage_amount = projected_billed_total - approved_scope_limit
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
    _record_financial_audit_event(
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
    next_number = Invoice.objects.filter(project=project, created_by=user).count() + 1
    candidate = f"INV-{next_number:04d}"
    while Invoice.objects.filter(project=project, invoice_number=candidate).exists():
        next_number += 1
        candidate = f"INV-{next_number:04d}"
    return candidate


def _get_active_budget_for_project(*, project, user):
    return (
        Budget.objects.filter(
            project=project,
            created_by=user,
            status=Budget.Status.ACTIVE,
        )
        .order_by("-created_at")
        .first()
    )


def _calculate_invoice_line_totals(line_items_data):
    subtotal = Decimal("0")
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_price = Decimal(str(item["unit_price"]))
        line_total = quantity * unit_price
        subtotal += line_total
        normalized_items.append(
            {
                **item,
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": line_total,
            }
        )

    return normalized_items, subtotal


def _resolve_invoice_cost_codes_for_user(user, line_items_data):
    ids = [item["cost_code"] for item in line_items_data if item.get("cost_code")]
    if not ids:
        return {}, []

    codes = CostCode.objects.filter(created_by=user, id__in=ids)
    code_map = {code.id: code for code in codes}
    missing = [cost_code_id for cost_code_id in ids if cost_code_id not in code_map]
    return code_map, missing


def _apply_invoice_lines_and_totals(invoice, line_items_data, tax_percent, user):
    normalized_items, subtotal = _calculate_invoice_line_totals(line_items_data)
    code_map, missing = _resolve_invoice_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_percent = Decimal(str(tax_percent))
    tax_total = subtotal * (tax_percent / Decimal("100"))
    total = subtotal + tax_total

    invoice.line_items.all().delete()
    new_lines = []
    for item in normalized_items:
        cost_code_id = item.get("cost_code")
        cost_code = code_map.get(cost_code_id) if cost_code_id else None
        new_lines.append(
            InvoiceLine(
                invoice=invoice,
                cost_code=cost_code,
                description=item["description"],
                quantity=item["quantity"],
                unit=item.get("unit", "ea"),
                unit_price=item["unit_price"],
                line_total=item["line_total"],
            )
        )
    InvoiceLine.objects.bulk_create(new_lines)

    invoice.subtotal = subtotal
    invoice.tax_percent = tax_percent
    invoice.tax_total = tax_total
    invoice.total = total
    invoice.balance_due = Decimal("0") if invoice.status == Invoice.Status.PAID else total
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


def _build_budget_baseline_snapshot(estimate):
    return {
        "estimate": {
            "id": estimate.id,
            "project_id": estimate.project_id,
            "version": estimate.version,
            "status": estimate.status,
            "title": estimate.title,
            "subtotal": str(estimate.subtotal),
            "markup_total": str(estimate.markup_total),
            "tax_percent": str(estimate.tax_percent),
            "tax_total": str(estimate.tax_total),
            "grand_total": str(estimate.grand_total),
            "created_at": estimate.created_at.isoformat(),
            "updated_at": estimate.updated_at.isoformat(),
        },
        "line_items": [
            {
                "estimate_line_item_id": line.id,
                "cost_code_id": line.cost_code_id,
                "cost_code_code": line.cost_code.code,
                "cost_code_name": line.cost_code.name,
                "description": line.description,
                "quantity": str(line.quantity),
                "unit": line.unit,
                "unit_cost": str(line.unit_cost),
                "markup_percent": str(line.markup_percent),
                "line_total": str(line.line_total),
            }
            for line in estimate.line_items.all()
        ],
    }


def _supersede_active_project_budgets(*, project, user):
    active_budgets = Budget.objects.filter(
        project=project,
        created_by=user,
        status=Budget.Status.ACTIVE,
    )
    for budget in active_budgets:
        budget.status = Budget.Status.SUPERSEDED
        budget.save(update_fields=["status", "updated_at"])


def _create_budget_from_estimate(*, estimate, user):
    _supersede_active_project_budgets(project=estimate.project, user=user)
    budget = Budget.objects.create(
        project=estimate.project,
        status=Budget.Status.ACTIVE,
        source_estimate=estimate,
        baseline_snapshot_json=_build_budget_baseline_snapshot(estimate),
        created_by=user,
    )

    budget_lines = [
        BudgetLine(
            budget=budget,
            cost_code=line.cost_code,
            description=line.description,
            budget_amount=line.line_total,
        )
        for line in estimate.line_items.all()
    ]
    BudgetLine.objects.bulk_create(budget_lines)
    return budget
