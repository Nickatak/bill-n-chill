"""Domain-specific helpers for estimate views."""

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
    Estimate,
    EstimateLineItem,
    EstimateSection,
    EstimateStatusEvent,
    Project,
)
from core.serializers import EstimateSerializer
from core.user_helpers import _ensure_org_membership
from django_q.tasks import async_task
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _promote_prospect_to_active, _resolve_cost_codes_for_user


# ---------------------------------------------------------------------------
# Constants (imported by views)
# ---------------------------------------------------------------------------

CONTRACT_PDF_MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
CONTRACT_PDF_ALLOWED_CONTENT_TYPES = {"application/pdf"}

ESTIMATE_DECISION_TO_STATUS: dict[str, str] = {
    "approve": Estimate.Status.APPROVED,
    "approved": Estimate.Status.APPROVED,
    "reject": Estimate.Status.REJECTED,
    "rejected": Estimate.Status.REJECTED,
}


# ---------------------------------------------------------------------------
# Query prefetch
# ---------------------------------------------------------------------------


def _prefetch_estimate_qs(queryset: QuerySet) -> QuerySet:
    """Apply standard select/prefetch for estimate serialization.

    Prevents N+1 queries when serializing estimates with their
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
    )


# ---------------------------------------------------------------------------
# Duplicate-suppression signatures
# ---------------------------------------------------------------------------


def _line_items_signature(line_items_data: list[dict]) -> list[tuple]:
    """Build a normalized signature from raw line-item input dicts.

    Returns a list of tuples for structural comparison against stored
    estimates during the duplicate-submit suppression window.
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


def _estimate_stored_signature(estimate: Estimate) -> list[tuple]:
    """Build a normalized signature from an existing estimate's line items.

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
        for item in estimate.line_items.all()
    ]


# ---------------------------------------------------------------------------
# Family and archival helpers
# ---------------------------------------------------------------------------


def _archive_estimate_family(
    *,
    project: Project,
    user: AbstractUser,
    title: str,
    exclude_ids: list[int],
    note: str,
) -> None:
    """Archive all same-title estimates in a family except the excluded IDs.

    Iterates non-archived estimates in the family, checks whether the
    transition to ``archived`` is allowed, and records an audit event for
    each one that transitions.  Called after creating a new version to
    supersede older family members.
    """
    normalized_title = (title or "").strip()
    if not normalized_title:
        return

    candidates = (
        Estimate.objects.filter(
            project=project,
            title=normalized_title,
        )
        .exclude(id__in=exclude_ids)
        .exclude(status=Estimate.Status.ARCHIVED)
    )
    for candidate in candidates:
        if not Estimate.is_transition_allowed(
            current_status=candidate.status,
            next_status=Estimate.Status.ARCHIVED,
        ):
            continue
        previous_status = candidate.status
        candidate.status = Estimate.Status.ARCHIVED
        candidate.save(update_fields=["status", "updated_at"])
        EstimateStatusEvent.record(
            estimate=candidate,
            from_status=previous_status,
            to_status=Estimate.Status.ARCHIVED,
            note=note,
            changed_by=user,
        )
        logger.info("Estimate archived: id=%s title='%s' v%s (%s → archived)", candidate.id, candidate.title, candidate.version, previous_status)


def _next_estimate_family_version(*, project: Project, title: str) -> int:
    """Return the next version number for an estimate family identified by title.

    Queries the highest existing version for the normalized title within
    the project and returns ``max_version + 1``, or ``1`` if no prior
    versions exist.
    """
    normalized_title = (title or "").strip()
    latest = (
        Estimate.objects.filter(
            project=project,
            title=normalized_title,
        )
        .order_by("-version")
        .first()
    )
    return (latest.version + 1) if latest else 1


def _sync_project_contract_baseline_if_unset(*, estimate: Estimate) -> bool:
    """Set the project's contract values from the estimate if both are still zero.

    Returns ``True`` if values were updated, ``False`` if they were already
    set.  Used to bootstrap contract baselines from the first approved
    estimate.
    """
    project = estimate.project
    if project.contract_value_original != Decimal("0") or project.contract_value_current != Decimal("0"):
        return False
    project.contract_value_original = estimate.grand_total
    project.contract_value_current = estimate.grand_total
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


def _apply_estimate_lines_and_totals(
    estimate: Estimate,
    line_items_data: list[dict],
    tax_percent: Decimal,
    user: AbstractUser,
    sections_data: list[dict] | None = None,
    contingency_percent: Decimal = Decimal("0"),
    overhead_profit_percent: Decimal = Decimal("0"),
    insurance_percent: Decimal = Decimal("0"),
) -> dict | None:
    """Replace an estimate's line items, sections, and recompute all totals.

    Deletes existing line items and sections, resolves cost codes for the user,
    bulk-creates new lines and sections, and updates the estimate's financial
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

    estimate.line_items.all().delete()
    estimate.sections.all().delete()

    lines_to_create = []
    taxable_base = MONEY_ZERO
    for line_item in computed_line_items:
        description = (line_item.get("description") or "").strip()
        unit_value = (line_item.get("unit") or "ea").strip().lower() or "ea"
        cost_code = cost_code_map[line_item["cost_code"]]

        if cost_code.taxable:
            taxable_base = quantize_money(taxable_base + line_item["line_total"])

        lines_to_create.append(
            EstimateLineItem(
                estimate=estimate,
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
    EstimateLineItem.objects.bulk_create(lines_to_create)

    if sections_data:
        computed_sections = _compute_section_subtotals(sections_data, computed_line_items)
        EstimateSection.objects.bulk_create([
            EstimateSection(
                estimate=estimate,
                name=section["name"],
                order=section["order"],
                subtotal=section["subtotal"],
            )
            for section in computed_sections
        ])

    estimate.subtotal = subtotal
    estimate.markup_total = markup_total
    estimate.contingency_percent = contingency_percent
    estimate.contingency_total = contingency_total
    estimate.overhead_profit_percent = overhead_profit_percent
    estimate.overhead_profit_total = overhead_profit_total
    estimate.insurance_percent = insurance_percent
    estimate.insurance_total = insurance_total
    estimate.tax_percent = tax_percent
    estimate.tax_total = tax_total
    estimate.grand_total = grand_total
    estimate.save(
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
# PATCH concern handlers — called by the thin dispatcher in estimates.py
# ---------------------------------------------------------------------------


def _handle_estimate_document_save(
    request: Request,
    estimate: Estimate,
    data: dict[str, Any],
) -> Response:
    """Apply field updates, line items, and totals to an estimate (save concern).

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
            estimate.title = data["title"]
            update_fields.append("title")
        if "valid_through" in data:
            estimate.valid_through = data["valid_through"]
            update_fields.append("valid_through")
        if "tax_percent" in data:
            estimate.tax_percent = data["tax_percent"]
            update_fields.append("tax_percent")
        if "contingency_percent" in data:
            estimate.contingency_percent = data["contingency_percent"]
            update_fields.append("contingency_percent")
        if "overhead_profit_percent" in data:
            estimate.overhead_profit_percent = data["overhead_profit_percent"]
            update_fields.append("overhead_profit_percent")
        if "insurance_percent" in data:
            estimate.insurance_percent = data["insurance_percent"]
            update_fields.append("insurance_percent")
        if "notes_text" in data:
            estimate.notes_text = (data["notes_text"] or "").strip()
            update_fields.append("notes_text")
        if len(update_fields) > 1:
            estimate.save(update_fields=update_fields)

        bid_percent_fields = {"tax_percent", "contingency_percent", "overhead_profit_percent", "insurance_percent"}
        if "line_items" in data:
            if apply_error := _apply_estimate_lines_and_totals(
                estimate=estimate,
                line_items_data=data["line_items"],
                tax_percent=data.get("tax_percent", estimate.tax_percent),
                user=request.user,
                sections_data=data.get("sections"),
                contingency_percent=data.get("contingency_percent", estimate.contingency_percent),
                overhead_profit_percent=data.get("overhead_profit_percent", estimate.overhead_profit_percent),
                insurance_percent=data.get("insurance_percent", estimate.insurance_percent),
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
                for line in estimate.line_items.all()
            ]
            current_sections = [
                {"name": section.name, "order": section.order}
                for section in estimate.sections.all()
            ]
            _apply_estimate_lines_and_totals(
                estimate=estimate,
                line_items_data=current_line_dicts,
                tax_percent=estimate.tax_percent,
                user=request.user,
                sections_data=current_sections,
                contingency_percent=estimate.contingency_percent,
                overhead_profit_percent=estimate.overhead_profit_percent,
                insurance_percent=estimate.insurance_percent,
            )

    estimate.refresh_from_db()
    return Response({"data": EstimateSerializer(estimate, context={"request": request}).data, "email_sent": False})


def _handle_estimate_status_transition(
    request: Request,
    estimate: Estimate,
    data: dict[str, Any],
    previous_status: str,
    next_status: str,
    is_resend: bool,
) -> Response:
    """Handle an estimate status transition with identity freeze, audit, and email.

    Called when the PATCH includes a real status change (previous != next)
    or a resend (sent -> sent).  Freezes org identity fields onto the
    document when leaving draft, records an audit event, activates the
    project on approval, and sends a notification email on send/resend.
    """
    status_note = (data.get("status_note", "") or "").strip()

    if not is_resend and not Estimate.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        if previous_status == Estimate.Status.DRAFT and next_status in {
            Estimate.Status.APPROVED,
            Estimate.Status.REJECTED,
        }:
            message = "Estimate must be sent before it can be approved or rejected."
        else:
            message = f"Invalid estimate status transition: {previous_status} -> {next_status}."
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
        estimate.status = next_status

        # Freeze org identity onto the document when leaving draft so public
        # pages never fall back to live (potentially changed) org defaults.
        if previous_status == Estimate.Status.DRAFT and next_status != Estimate.Status.DRAFT:
            membership = _ensure_org_membership(request.user)
            organization = membership.organization
            if not (estimate.terms_text or "").strip():
                org_terms = (organization.estimate_terms_and_conditions or "").strip()
                if org_terms:
                    estimate.terms_text = org_terms
                    update_fields.append("terms_text")
            if not (estimate.sender_name or "").strip():
                org_name = (organization.display_name or "").strip()
                if org_name:
                    estimate.sender_name = org_name
                    update_fields.append("sender_name")
            if not (estimate.sender_address or "").strip():
                org_address = organization.formatted_billing_address
                if org_address:
                    estimate.sender_address = org_address
                    update_fields.append("sender_address")
            if not (estimate.sender_logo_url or "").strip():
                if organization.logo:
                    estimate.sender_logo_url = request.build_absolute_uri(organization.logo.url)
                    update_fields.append("sender_logo_url")

        estimate.save(update_fields=update_fields)

        # Audit event
        event_note = status_note or ("Estimate re-sent." if is_resend else "Estimate status updated.")
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=previous_status,
            to_status=next_status,
            note=event_note,
            changed_by=request.user,
        )
        logger.info("Estimate status transition: id=%s title='%s' v%s (%s → %s) by %s", estimate.id, estimate.title, estimate.version, previous_status, next_status, request.user.email)

        if next_status in (Estimate.Status.SENT, Estimate.Status.APPROVED):
            _promote_prospect_to_active(estimate.project)

    # Email notification (outside transaction, async)
    email_sent = False
    notify_customer = data.get("notify_customer", True)
    if notify_customer and next_status == Estimate.Status.SENT and (
        previous_status != Estimate.Status.SENT or is_resend
    ):
        customer_email = (estimate.project.customer.email or "").strip()
        if customer_email:
            async_task(
                "core.tasks.send_document_sent_email_task",
                "Estimate",
                f"{estimate.title} (v{estimate.version})",
                f"{settings.FRONTEND_URL}/estimate/{estimate.public_ref}",
                customer_email,
                request.user.id,
            )
            email_sent = True

    estimate.refresh_from_db()
    return Response({"data": EstimateSerializer(estimate, context={"request": request}).data, "email_sent": email_sent})


def _handle_estimate_status_note(
    request: Request,
    estimate: Estimate,
    data: dict[str, Any],
) -> Response:
    """Append an audit note to the estimate timeline without changing status.

    Called when the PATCH includes a ``status_note`` but no actual status
    transition.  Records a same-status audit event with the note text.
    """
    note_text = (data.get("status_note", "") or "").strip()

    with transaction.atomic():
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=estimate.status,
            to_status=estimate.status,
            note=note_text,
            changed_by=request.user,
        )

    estimate.refresh_from_db()
    return Response({"data": EstimateSerializer(estimate, context={"request": request}).data, "email_sent": False})
