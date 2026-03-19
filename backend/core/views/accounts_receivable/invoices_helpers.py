"""Domain-specific helpers for invoice views."""

from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from rest_framework.response import Response

from core.models import (
    Invoice,
    InvoiceLine,
    InvoiceStatusEvent,
    Payment,
    Project,
)
from core.serializers import InvoiceSerializer
from core.utils.email import send_document_sent_email
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
        Payment.objects.filter(
            invoice=invoice,
            status=Payment.Status.SETTLED,
        ).aggregate(total=Sum("amount")).get("total")
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


# ---------------------------------------------------------------------------
# PATCH concern handlers — called by the thin dispatcher in invoices.py
# ---------------------------------------------------------------------------


def _handle_invoice_document_save(request, invoice, ingress):
    """Apply field updates, line items, and totals to an invoice (the 'save' concern).

    Handles dates, tax_percent, sender fields, terms, footer, notes, line items,
    and totals recomputation.  Does not modify status or record audit events.
    """
    # Date cross-validation
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

    # Line item cost code pre-validation
    if ingress.has_line_items:
        if not ingress.line_items:
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
        _, missing_cost_codes = _resolve_cost_codes_for_user(request.user, ingress.line_items)
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

    with transaction.atomic():
        update_fields = ["updated_at"]
        if ingress.has_issue_date:
            invoice.issue_date = ingress.issue_date
            update_fields.append("issue_date")
        if ingress.has_due_date:
            invoice.due_date = ingress.due_date
            update_fields.append("due_date")
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

    invoice.refresh_from_db()
    return Response({"data": InvoiceSerializer(invoice).data, "email_sent": False})


def _handle_invoice_status_transition(
    request, invoice, ingress, membership, previous_status, next_status, is_resend,
):
    """Handle an invoice status transition: validate, apply, freeze org identity, audit, email.

    Called when the PATCH includes a real status change (previous != next) or a resend
    (sent -> sent).  Handles org identity freeze on draft departure, balance
    recomputation, audit event recording, and email notification.
    """
    status_note = ingress.status_note.strip() if ingress.has_status_note else ""

    if not is_resend and not Invoice.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid invoice status transition: {previous_status} -> {next_status}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        update_fields = ["status", "updated_at"]
        invoice.status = next_status

        # Freeze org identity onto the document when leaving draft so public
        # pages never fall back to live (potentially changed) org defaults.
        if previous_status == Invoice.Status.DRAFT and next_status != Invoice.Status.DRAFT:
            organization = membership.organization
            if not (invoice.terms_text or "").strip():
                org_terms = (organization.invoice_terms_and_conditions or "").strip()
                if org_terms:
                    invoice.terms_text = org_terms
                    update_fields.append("terms_text")
            if not (invoice.sender_name or "").strip():
                org_name = (organization.display_name or "").strip()
                if org_name:
                    invoice.sender_name = org_name
                    update_fields.append("sender_name")
            if not (invoice.sender_address or "").strip():
                org_address = organization.formatted_billing_address
                if org_address:
                    invoice.sender_address = org_address
                    update_fields.append("sender_address")
            if not (invoice.sender_logo_url or "").strip():
                if organization.logo:
                    invoice.sender_logo_url = request.build_absolute_uri(organization.logo.url)
                    update_fields.append("sender_logo_url")

        invoice.save(update_fields=update_fields)

        # Recompute balance_due from settled allocations without overriding
        # the status the user just set.
        applied_total = (
            Payment.objects.filter(
                invoice=invoice,
                status=Payment.Status.SETTLED,
            ).aggregate(total=Sum("amount")).get("total")
            or Decimal("0")
        )
        invoice.balance_due = max(
            quantize_money(Decimal(str(invoice.total)) - applied_total),
            Decimal("0"),
        )
        if invoice.status == Invoice.Status.PAID:
            invoice.balance_due = Decimal("0")
        invoice.save(update_fields=["balance_due", "updated_at"])

        # Audit event
        event_note = status_note or ("Invoice re-sent." if is_resend else "Invoice status updated.")
        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=previous_status,
            to_status=next_status,
            note=event_note,
            changed_by=request.user,
        )

    # Email notification (outside transaction)
    email_sent = False
    if next_status == Invoice.Status.SENT and (
        previous_status != Invoice.Status.SENT or is_resend
    ):
        customer_email = (invoice.customer.email or "").strip()
        email_sent = send_document_sent_email(
            document_type="Invoice",
            document_title=f"Invoice {invoice.invoice_number}",
            public_url=f"{settings.FRONTEND_URL}/invoice/{invoice.public_ref}",
            recipient_email=customer_email,
            sender_user=request.user,
        )

    invoice.refresh_from_db()
    return Response({"data": InvoiceSerializer(invoice).data, "email_sent": email_sent})


def _handle_invoice_status_note(request, invoice, ingress):
    """Append an audit note to the invoice timeline without changing status.

    Called when the PATCH includes a status_note but no actual status change.
    """
    note_text = ingress.status_note.strip()

    with transaction.atomic():
        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=invoice.status,
            to_status=invoice.status,
            note=note_text,
            changed_by=request.user,
        )

    invoice.refresh_from_db()
    return Response({"data": InvoiceSerializer(invoice).data, "email_sent": False})
