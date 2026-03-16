"""Domain-specific helpers for invoice views."""

from decimal import Decimal

from django.db.models import Sum

from core.models import (
    Invoice,
    InvoiceLine,
    Payment,
    PaymentAllocation,
    Project,
)
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
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
    query = Invoice.objects.filter(
        project=project,
        status__in=BILLABLE_INVOICE_STATUSES,
    )
    if exclude_invoice_id:
        query = query.exclude(id=exclude_invoice_id)
    return quantize_money(query.aggregate(total=Sum("total")).get("total") or MONEY_ZERO)


def _next_invoice_number(*, project, user):
    """Generate the next unique sequential invoice number for a project."""
    next_number = (
        Invoice.objects.filter(
            project=project,
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


def _apply_invoice_lines_and_totals(invoice, line_items_data, tax_percent, user):
    """Replace an invoice's line items and recompute all totals. Returns an error dict on failure."""
    normalized_items, subtotal = _calculate_invoice_line_totals(line_items_data)
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_percent = Decimal(str(tax_percent))
    tax_total = quantize_money(subtotal * (tax_percent / Decimal("100")))
    total = quantize_money(subtotal + tax_total)

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

    # Recompute balance_due from the new total minus any settled payment allocations.
    applied_total = (
        PaymentAllocation.objects.filter(
            invoice=invoice,
            payment__status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("applied_amount")).get("total")
        or Decimal("0")
    )
    balance_due = quantize_money(total - applied_total)
    if balance_due < MONEY_ZERO:
        balance_due = MONEY_ZERO

    invoice.subtotal = subtotal
    invoice.tax_percent = tax_percent
    invoice.tax_total = tax_total
    invoice.total = total
    invoice.balance_due = balance_due
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


def _activate_project_from_invoice_creation(*, invoice, actor):
    """Transition a prospect project to active when a direct invoice is created."""
    project = invoice.project
    if project.status != Project.Status.PROSPECT:
        return False
    if not Project.is_transition_allowed(project.status, Project.Status.ACTIVE):
        return False

    project.status = Project.Status.ACTIVE
    project.save(update_fields=["status", "updated_at"])
    return True
