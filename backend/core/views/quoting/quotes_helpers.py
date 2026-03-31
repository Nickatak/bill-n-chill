"""Domain-specific helpers for quote views."""

import logging

from decimal import Decimal
from typing import Any

logger = logging.getLogger(__name__)

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import transaction
from django.db.models import QuerySet
from rest_framework.request import Request
from rest_framework.response import Response

from core.models import (
    BillingPeriod,
    Quote,
    QuoteLineItem,
    QuoteSection,
    QuoteStatusEvent,
    Project,
)
from core.serializers import QuoteSerializer
from core.user_helpers import _ensure_org_membership
from django_q.tasks import async_task
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _promote_prospect_to_active, _resolve_cost_codes_for_user


# ---------------------------------------------------------------------------
# Serializer-error formatting
# ---------------------------------------------------------------------------


_BILLING_PERIOD_FIELD_LABELS: dict[str, str] = {
    "percent": "% amount",
    "description": "description",
    "due_date": "due date",
}


def _format_serializer_errors(errors: dict) -> str:
    """Flatten DRF serializer errors into a single human-readable message.

    Handles nested list-of-dict structures (e.g. billing_periods) by
    collecting the distinct failing fields and producing a single sentence.
    """
    messages: list[str] = []
    for field, detail in errors.items():
        if field == "billing_periods" and isinstance(detail, list) and detail and isinstance(detail[0], dict):
            failing_fields: set[str] = set()
            for item_errors in detail:
                for sub_field in item_errors:
                    failing_fields.add(sub_field)
            labels = [_BILLING_PERIOD_FIELD_LABELS.get(f, f) for f in sorted(failing_fields)]
            joined = " and ".join(labels) if len(labels) <= 2 else ", ".join(labels[:-1]) + f", and {labels[-1]}"
            verb = "is" if len(labels) == 1 else "are"
            messages.append(f"A valid {joined} {verb} required on all billing periods.")
        elif isinstance(detail, list) and detail and isinstance(detail[0], dict):
            for i, item_errors in enumerate(detail):
                for sub_field, sub_msgs in item_errors.items():
                    if isinstance(sub_msgs, list) and sub_msgs:
                        messages.append(f"{field} row {i + 1}: {sub_field} — {sub_msgs[0]}")
        elif isinstance(detail, list) and detail:
            msg = str(detail[0])
            messages.append(msg if field == "billing_periods" else f"{field}: {msg}")
    return "; ".join(messages) if messages else "Validation failed."


# ---------------------------------------------------------------------------
# Constants (imported by views)
# ---------------------------------------------------------------------------

CONTRACT_PDF_MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
CONTRACT_PDF_ALLOWED_CONTENT_TYPES = {"application/pdf"}

QUOTE_DECISION_TO_STATUS: dict[str, str] = {
    "approve": Quote.Status.APPROVED,
    "approved": Quote.Status.APPROVED,
    "reject": Quote.Status.REJECTED,
    "rejected": Quote.Status.REJECTED,
}


# ---------------------------------------------------------------------------
# Query prefetch
# ---------------------------------------------------------------------------


def _prefetch_quote_qs(queryset: QuerySet) -> QuerySet:
    """Apply standard select/prefetch for quote serialization.

    Prevents N+1 queries when serializing quotes with their
    related project, customer, creator, line items, and cost codes.
    """
    return queryset.select_related(
        "project",
        "project__customer",
        "created_by",
    ).prefetch_related(
        "line_items",
        "line_items__cost_code",
        "sections",
        "billing_periods",
    )


# ---------------------------------------------------------------------------
# Duplicate-suppression signatures
# ---------------------------------------------------------------------------


def _line_items_signature(line_items_data: list[dict]) -> list[tuple]:
    """Build a normalized signature from raw line-item input dicts.

    Returns a list of tuples for structural comparison against stored
    quotes during the duplicate-submit suppression window.
    """
    signature = []
    for line_item in line_items_data:
        signature.append(
            (
                int(line_item["cost_code"]),
                (line_item.get("description") or "").strip(),
                str(line_item.get("quantity", "")),
                (line_item.get("unit") or "").strip(),
                str(line_item.get("unit_price", "")),
                str(line_item.get("markup_percent", "")),
            )
        )
    return signature


def _quote_stored_signature(quote: Quote) -> list[tuple]:
    """Build a normalized signature from an existing quote's line items.

    Returns a list of tuples matching the shape of ``_line_items_signature``
    so the two can be compared for duplicate detection.
    """
    return [
        (
            item.cost_code_id,
            (item.description or "").strip(),
            str(item.quantity),
            (item.unit or "").strip(),
            str(item.unit_price),
            str(item.markup_percent),
        )
        for item in quote.line_items.all()
    ]


# ---------------------------------------------------------------------------
# Family and archival helpers
# ---------------------------------------------------------------------------


def _archive_quote_family(
    *,
    project: Project,
    user: AbstractUser,
    title: str,
    exclude_ids: list[int],
    note: str,
) -> None:
    """Archive all same-title quotes in a family except the excluded IDs.

    Iterates non-archived quotes in the family, checks whether the
    transition to ``archived`` is allowed, and records an audit event for
    each one that transitions.  Called after creating a new version to
    supersede older family members.
    """
    normalized_title = (title or "").strip()
    if not normalized_title:
        return

    candidates = (
        Quote.objects.filter(
            project=project,
            title=normalized_title,
        )
        .exclude(id__in=exclude_ids)
        .exclude(status=Quote.Status.ARCHIVED)
    )
    for candidate in candidates:
        if not Quote.is_transition_allowed(
            current_status=candidate.status,
            next_status=Quote.Status.ARCHIVED,
        ):
            continue
        previous_status = candidate.status
        candidate.status = Quote.Status.ARCHIVED
        candidate.save(update_fields=["status", "updated_at"])
        QuoteStatusEvent.record(
            quote=candidate,
            from_status=previous_status,
            to_status=Quote.Status.ARCHIVED,
            note=note,
            changed_by=user,
        )
        logger.info("Quote archived: id=%s title='%s' v%s (%s → archived)", candidate.id, candidate.title, candidate.version, previous_status)


def _next_quote_family_version(*, project: Project, title: str) -> int:
    """Return the next version number for an quote family identified by title.

    Queries the highest existing version for the normalized title within
    the project and returns ``max_version + 1``, or ``1`` if no prior
    versions exist.
    """
    normalized_title = (title or "").strip()
    latest = (
        Quote.objects.filter(
            project=project,
            title=normalized_title,
        )
        .order_by("-version")
        .first()
    )
    return (latest.version + 1) if latest else 1


def _sync_project_contract_baseline_if_unset(*, quote: Quote) -> bool:
    """Set the project's contract values from the quote if both are still zero.

    Returns ``True`` if values were updated, ``False`` if they were already
    set.  Used to bootstrap contract baselines from the first approved
    quote.
    """
    project = quote.project
    if project.contract_value_original != Decimal("0") or project.contract_value_current != Decimal("0"):
        return False
    project.contract_value_original = quote.grand_total
    project.contract_value_current = quote.grand_total
    project.save(update_fields=["contract_value_original", "contract_value_current", "updated_at"])
    return True



def _calculate_line_totals(
    line_items_data: list[dict],
) -> tuple[list[dict], Decimal, Decimal]:
    """Compute per-line totals with markup and return normalized items.

    Returns ``(normalized_items, subtotal, markup_total)`` where each
    normalized item has ``line_total`` added and numeric fields coerced
    to ``Decimal``.
    """
    subtotal = MONEY_ZERO
    markup_total = MONEY_ZERO
    computed_line_items = []

    for line_item in line_items_data:
        quantity = Decimal(str(line_item["quantity"]))
        unit_price = Decimal(str(line_item["unit_price"]))
        markup_percent = Decimal(str(line_item.get("markup_percent", 0)))
        base_total = quantize_money(quantity * unit_price)
        line_markup = quantize_money(base_total * (markup_percent / Decimal("100")))
        line_total = quantize_money(base_total + line_markup)
        subtotal = quantize_money(subtotal + base_total)
        markup_total = quantize_money(markup_total + line_markup)
        computed_line_items.append(
            {
                **line_item,
                "quantity": quantity,
                "unit_price": unit_price,
                "markup_percent": markup_percent,
                "line_total": line_total,
            }
        )

    return computed_line_items, subtotal, markup_total


def _compute_section_subtotals(
    sections_data: list[dict],
    line_items_with_totals: list[dict],
) -> list[dict]:
    """Compute each section's subtotal from the line items that follow it.

    A section's subtotal is the sum of ``line_total`` for all line items whose
    ``order`` falls between this section's ``order`` and the next section's
    ``order`` (or end of list). Returns sections with ``subtotal`` populated.
    """
    if not sections_data:
        return []

    sorted_sections = sorted(sections_data, key=lambda s: s["order"])
    line_totals_by_order = {
        item["order"]: item["line_total"] for item in line_items_with_totals
    }
    all_line_orders = sorted(line_totals_by_order.keys())

    result = []
    for i, section in enumerate(sorted_sections):
        section_order = section["order"]
        next_boundary = sorted_sections[i + 1]["order"] if i + 1 < len(sorted_sections) else float("inf")

        subtotal = MONEY_ZERO
        for line_order in all_line_orders:
            if line_order > section_order and line_order < next_boundary:
                subtotal = quantize_money(subtotal + line_totals_by_order[line_order])

        result.append({**section, "subtotal": subtotal})

    return result


def _apply_quote_lines_and_totals(
    quote: Quote,
    line_items_data: list[dict],
    tax_percent: Decimal,
    user: AbstractUser,
    sections_data: list[dict] | None = None,
    contingency_percent: Decimal = Decimal("0"),
    overhead_profit_percent: Decimal = Decimal("0"),
    insurance_percent: Decimal = Decimal("0"),
) -> dict | None:
    """Replace an quote's line items, sections, and recompute all totals.

    Deletes existing line items and sections, resolves cost codes for the user,
    bulk-creates new lines and sections, and updates the quote's financial
    totals. Section subtotals are computed from the line items that follow each
    section in ordering space. Returns an error dict on validation failure, or
    ``None`` on success.
    """
    computed_line_items, subtotal, markup_total = _calculate_line_totals(line_items_data)
    cost_code_map, missing = _resolve_cost_codes_for_user(user, computed_line_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_percent = Decimal(str(tax_percent))
    contingency_percent = Decimal(str(contingency_percent))
    overhead_profit_percent = Decimal(str(overhead_profit_percent))
    insurance_percent = Decimal(str(insurance_percent))

    quote.line_items.all().delete()
    quote.sections.all().delete()

    lines_to_create = []
    taxable_base = MONEY_ZERO
    for line_item in computed_line_items:
        description = (line_item.get("description") or "").strip()
        unit_value = (line_item.get("unit") or "ea").strip().lower() or "ea"
        cost_code = cost_code_map[line_item["cost_code"]]

        if cost_code.taxable:
            taxable_base = quantize_money(taxable_base + line_item["line_total"])

        lines_to_create.append(
            QuoteLineItem(
                quote=quote,
                cost_code=cost_code,
                description=description,
                quantity=line_item["quantity"],
                unit=unit_value,
                unit_price=line_item["unit_price"],
                markup_percent=line_item["markup_percent"],
                line_total=line_item["line_total"],
                order=line_item.get("order", 0),
            )
        )

    # Bid markup totals (applied to subtotal + line-level markup)
    bid_markup_base = quantize_money(subtotal + markup_total)
    contingency_total = quantize_money(bid_markup_base * contingency_percent / Decimal("100"))
    overhead_profit_total = quantize_money(bid_markup_base * overhead_profit_percent / Decimal("100"))
    insurance_total = quantize_money(bid_markup_base * insurance_percent / Decimal("100"))

    tax_total = quantize_money(taxable_base * (tax_percent / Decimal("100")))
    grand_total = quantize_money(
        subtotal + markup_total + contingency_total + overhead_profit_total + insurance_total + tax_total
    )
    QuoteLineItem.objects.bulk_create(lines_to_create)

    if sections_data:
        computed_sections = _compute_section_subtotals(sections_data, computed_line_items)
        QuoteSection.objects.bulk_create([
            QuoteSection(
                quote=quote,
                name=section["name"],
                order=section["order"],
                subtotal=section["subtotal"],
            )
            for section in computed_sections
        ])

    quote.subtotal = subtotal
    quote.markup_total = markup_total
    quote.contingency_percent = contingency_percent
    quote.contingency_total = contingency_total
    quote.overhead_profit_percent = overhead_profit_percent
    quote.overhead_profit_total = overhead_profit_total
    quote.insurance_percent = insurance_percent
    quote.insurance_total = insurance_total
    quote.tax_percent = tax_percent
    quote.tax_total = tax_total
    quote.grand_total = grand_total
    quote.save(
        update_fields=[
            "subtotal",
            "markup_total",
            "contingency_percent",
            "contingency_total",
            "overhead_profit_percent",
            "overhead_profit_total",
            "insurance_percent",
            "insurance_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "updated_at",
        ]
    )
    return None


# ---------------------------------------------------------------------------
# PATCH concern handlers — called by the thin dispatcher in quotes.py
# ---------------------------------------------------------------------------


def _handle_quote_document_save(
    request: Request,
    quote: Quote,
    data: dict[str, Any],
) -> Response:
    """Apply field updates, line items, and totals to an quote (save concern).

    Handles title, valid_through, tax_percent, and line items with totals
    recomputation.  Does not modify status or record audit events.  If only
    tax_percent changes without new line items, existing lines are
    recomputed with the new rate.
    """
    if "line_items" in data and not data["line_items"]:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one line item is required.",
                    "fields": {"line_items": ["At least one line item is required."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        update_fields = ["updated_at"]
        if "title" in data:
            quote.title = data["title"]
            update_fields.append("title")
        if "valid_through" in data:
            quote.valid_through = data["valid_through"]
            update_fields.append("valid_through")
        if "tax_percent" in data:
            quote.tax_percent = data["tax_percent"]
            update_fields.append("tax_percent")
        if "contingency_percent" in data:
            quote.contingency_percent = data["contingency_percent"]
            update_fields.append("contingency_percent")
        if "overhead_profit_percent" in data:
            quote.overhead_profit_percent = data["overhead_profit_percent"]
            update_fields.append("overhead_profit_percent")
        if "insurance_percent" in data:
            quote.insurance_percent = data["insurance_percent"]
            update_fields.append("insurance_percent")
        if "notes_text" in data:
            quote.notes_text = (data["notes_text"] or "").strip()
            update_fields.append("notes_text")
        if len(update_fields) > 1:
            quote.save(update_fields=update_fields)

        bid_percent_fields = {"tax_percent", "contingency_percent", "overhead_profit_percent", "insurance_percent"}
        if "line_items" in data:
            if apply_error := _apply_quote_lines_and_totals(
                quote=quote,
                line_items_data=data["line_items"],
                tax_percent=data.get("tax_percent", quote.tax_percent),
                user=request.user,
                sections_data=data.get("sections"),
                contingency_percent=data.get("contingency_percent", quote.contingency_percent),
                overhead_profit_percent=data.get("overhead_profit_percent", quote.overhead_profit_percent),
                insurance_percent=data.get("insurance_percent", quote.insurance_percent),
            ):
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
        elif bid_percent_fields & data.keys():
            current_line_dicts = [
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit": line.unit,
                    "unit_price": line.unit_price,
                    "markup_percent": line.markup_percent,
                    "order": line.order,
                }
                for line in quote.line_items.all()
            ]
            current_sections = [
                {"name": section.name, "order": section.order}
                for section in quote.sections.all()
            ]
            _apply_quote_lines_and_totals(
                quote=quote,
                line_items_data=current_line_dicts,
                tax_percent=quote.tax_percent,
                user=request.user,
                sections_data=current_sections,
                contingency_percent=quote.contingency_percent,
                overhead_profit_percent=quote.overhead_profit_percent,
                insurance_percent=quote.insurance_percent,
            )

        # Billing periods — independent of line items / totals
        if "billing_periods" in data:
            quote.billing_periods.all().delete()
            bp_data = data["billing_periods"]
            if bp_data:
                BillingPeriod.objects.bulk_create([
                    BillingPeriod(
                        quote=quote,
                        description=p["description"],
                        percent=p["percent"],
                        due_date=p.get("due_date"),
                        order=p["order"],
                    )
                    for p in bp_data
                ])

    quote.refresh_from_db()
    return Response({"data": QuoteSerializer(quote, context={"request": request}).data, "email_sent": False})


def _handle_quote_status_transition(
    request: Request,
    quote: Quote,
    data: dict[str, Any],
    previous_status: str,
    next_status: str,
    is_resend: bool,
) -> Response:
    """Handle an quote status transition with identity freeze, audit, and email.

    Called when the PATCH includes a real status change (previous != next)
    or a resend (sent -> sent).  Freezes org identity fields onto the
    document when leaving draft, records an audit event, activates the
    project on approval, and sends a notification email on send/resend.
    """
    status_note = (data.get("status_note", "") or "").strip()

    if not is_resend and not Quote.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        if previous_status == Quote.Status.DRAFT and next_status in {
            Quote.Status.APPROVED,
            Quote.Status.REJECTED,
        }:
            message = "Quote must be sent before it can be approved or rejected."
        else:
            message = f"Invalid quote status transition: {previous_status} -> {next_status}."
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": message,
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        update_fields = ["status", "updated_at"]
        quote.status = next_status

        # Freeze org identity onto the document when leaving draft so public
        # pages never fall back to live (potentially changed) org defaults.
        if previous_status == Quote.Status.DRAFT and next_status != Quote.Status.DRAFT:
            membership = _ensure_org_membership(request.user)
            organization = membership.organization
            if not (quote.terms_text or "").strip():
                org_terms = (organization.quote_terms_and_conditions or "").strip()
                if org_terms:
                    quote.terms_text = org_terms
                    update_fields.append("terms_text")
            if not (quote.sender_name or "").strip():
                org_name = (organization.display_name or "").strip()
                if org_name:
                    quote.sender_name = org_name
                    update_fields.append("sender_name")
            if not (quote.sender_address or "").strip():
                org_address = organization.formatted_billing_address
                if org_address:
                    quote.sender_address = org_address
                    update_fields.append("sender_address")
            if not (quote.sender_logo_url or "").strip():
                if organization.logo:
                    quote.sender_logo_url = request.build_absolute_uri(organization.logo.url)
                    update_fields.append("sender_logo_url")

        quote.save(update_fields=update_fields)

        # Audit event
        event_note = status_note or ("Quote re-sent." if is_resend else "Quote status updated.")
        QuoteStatusEvent.record(
            quote=quote,
            from_status=previous_status,
            to_status=next_status,
            note=event_note,
            changed_by=request.user,
        )
        logger.info("Quote status transition: id=%s title='%s' v%s (%s → %s) by %s", quote.id, quote.title, quote.version, previous_status, next_status, request.user.email)

        if next_status in (Quote.Status.SENT, Quote.Status.APPROVED):
            _promote_prospect_to_active(quote.project)

    # Email notification (outside transaction, async)
    email_sent = False
    notify_customer = data.get("notify_customer", True)
    if notify_customer and next_status == Quote.Status.SENT and (
        previous_status != Quote.Status.SENT or is_resend
    ):
        customer_email = (quote.project.customer.email or "").strip()
        if customer_email:
            async_task(
                "core.tasks.send_document_sent_email_task",
                "Quote",
                f"{quote.title} (v{quote.version})",
                f"{settings.FRONTEND_URL}/quote/{quote.public_ref}",
                customer_email,
                request.user.id,
            )
            email_sent = True

    quote.refresh_from_db()
    return Response({"data": QuoteSerializer(quote, context={"request": request}).data, "email_sent": email_sent})


def _handle_quote_status_note(
    request: Request,
    quote: Quote,
    data: dict[str, Any],
) -> Response:
    """Append an audit note to the quote timeline without changing status.

    Called when the PATCH includes a ``status_note`` but no actual status
    transition.  Records a same-status audit event with the note text.
    """
    note_text = (data.get("status_note", "") or "").strip()

    with transaction.atomic():
        QuoteStatusEvent.record(
            quote=quote,
            from_status=quote.status,
            to_status=quote.status,
            note=note_text,
            changed_by=request.user,
        )

    quote.refresh_from_db()
    return Response({"data": QuoteSerializer(quote, context={"request": request}).data, "email_sent": False})
