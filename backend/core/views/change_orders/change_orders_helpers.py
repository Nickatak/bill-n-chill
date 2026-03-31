"""Domain-specific helpers for change-order views."""

import logging

from decimal import Decimal
from typing import Any

logger = logging.getLogger(__name__)

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, QuerySet, Sum
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    ChangeOrderLine,
    ChangeOrderSection,
    ChangeOrderSnapshot,
    ChangeOrderStatusEvent,
    CostCode,
    Quote,
    OrganizationMembership,
    Project,
)
from core.serializers import ChangeOrderSerializer
from django_q.tasks import async_task
from core.utils.money import MONEY_ZERO, quantize_money


# ---------------------------------------------------------------------------
# Constants (imported by views)
# ---------------------------------------------------------------------------

CONTRACT_PDF_MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
CONTRACT_PDF_ALLOWED_CONTENT_TYPES = {"application/pdf"}

CO_DECISION_TO_STATUS: dict[str, str] = {
    "approve": ChangeOrder.Status.APPROVED,
    "approved": ChangeOrder.Status.APPROVED,
    "reject": ChangeOrder.Status.REJECTED,
    "rejected": ChangeOrder.Status.REJECTED,
}


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


def _prefetch_change_order_qs(queryset: QuerySet) -> QuerySet:
    """Apply standard select/prefetch for change order serialization.

    Prevents N+1 queries when serializing change orders with their
    related project, customer, origin quote, line items, and cost codes.
    """
    return queryset.select_related(
        "project",
        "project__customer",
        "origin_quote",
        "requested_by",
        "approved_by",
    ).prefetch_related(
        "line_items",
        "line_items__cost_code",
        "sections",
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _validate_change_order_lines(
    *,
    line_items: list[dict],
    organization_id: int,
) -> tuple[dict[int, CostCode], Decimal, dict | None]:
    """Validate change-order line items and resolve cost codes.

    Returns ``(cost_code_map, line_total_delta, error_or_none)``.
    Each line must specify a ``cost_code`` that belongs to the organization.
    The error dict, when present, is a complete response payload ready for
    ``Response(error, status=400)``.
    """
    if not line_items:
        return {}, MONEY_ZERO, None

    cost_code_ids = set()
    for line_item_data in line_items:
        cc_id = line_item_data.get("cost_code")
        if not cc_id:
            return (
                {}, MONEY_ZERO,
                {"error": {"code": "validation_error", "message": "Lines must specify a cost code.", "fields": {"line_items": ["Provide cost_code for each line."]}}},
            )
        cost_code_ids.add(int(cc_id))

    cost_code_map = {}
    if cost_code_ids:
        cost_code_map = {
            cost_code.id: cost_code
            for cost_code in CostCode.objects.filter(
                id__in=cost_code_ids,
                organization_id=organization_id,
            )
        }
        if len(cost_code_map) != len(cost_code_ids):
            return (
                {}, MONEY_ZERO,
                {"error": {"code": "validation_error", "message": "One or more cost_code values are invalid.", "fields": {"line_items": ["Use valid cost_code ids."]}}},
            )

    line_total_delta = MONEY_ZERO
    for line_item_data in line_items:
        line_total_delta = quantize_money(line_total_delta + Decimal(str(line_item_data["amount_delta"])))
    return cost_code_map, line_total_delta, None


def _compute_co_section_subtotals(
    sections_data: list[dict],
    line_items_with_deltas: list[dict],
) -> list[dict]:
    """Compute each section's subtotal from the line items that follow it.

    A section's subtotal is the sum of ``amount_delta`` for all line items
    whose ``order`` falls between this section's ``order`` and the next
    section's ``order`` (or end of list). Returns sections with ``subtotal``
    populated. Note: subtotals can be negative since CO deltas are signed.
    """
    if not sections_data:
        return []

    sorted_sections = sorted(sections_data, key=lambda s: s["order"])
    deltas_by_order = {
        item["order"]: item["amount_delta"] for item in line_items_with_deltas
    }
    all_line_orders = sorted(deltas_by_order.keys())

    result = []
    for i, section in enumerate(sorted_sections):
        section_order = section["order"]
        next_boundary = sorted_sections[i + 1]["order"] if i + 1 < len(sorted_sections) else float("inf")

        subtotal = MONEY_ZERO
        for line_order in all_line_orders:
            if line_order > section_order and line_order < next_boundary:
                subtotal = quantize_money(subtotal + deltas_by_order[line_order])

        result.append({**section, "subtotal": subtotal})

    return result


def _sync_change_order_lines(
    *,
    change_order: ChangeOrder,
    line_items: list[dict],
    cost_code_map: dict[int, CostCode],
    sections_data: list[dict] | None = None,
) -> None:
    """Replace all line items (and optionally sections) on a change order.

    Deletes existing lines and creates new ones from the input dicts,
    resolving cost codes from the pre-validated map. When ``sections_data``
    is provided, old sections are replaced with new ones whose subtotals
    are computed from the line items via forward-scan.
    """
    ChangeOrderLine.objects.filter(change_order=change_order).delete()

    computed_line_items = []
    for line_item_data in line_items:
        cost_code = cost_code_map.get(int(line_item_data["cost_code"])) if line_item_data.get("cost_code") else None
        order = int(line_item_data.get("order", 0))
        amount = quantize_money(line_item_data["amount_delta"])
        ChangeOrderLine.objects.create(
            change_order=change_order,
            cost_code=cost_code,
            description=line_item_data.get("description", ""),
            adjustment_reason=str(line_item_data.get("adjustment_reason", "")).strip(),
            amount_delta=amount,
            days_delta=line_item_data.get("days_delta", 0),
            order=order,
        )
        computed_line_items.append({"order": order, "amount_delta": amount})

    if sections_data is not None:
        ChangeOrderSection.objects.filter(change_order=change_order).delete()
        computed_sections = _compute_co_section_subtotals(sections_data, computed_line_items)
        ChangeOrderSection.objects.bulk_create([
            ChangeOrderSection(
                change_order=change_order,
                name=section["name"],
                order=section["order"],
                subtotal=section["subtotal"],
            )
            for section in computed_sections
        ])


def _next_change_order_family_key(*, project: Project) -> str:
    """Return the next numeric family key string for change orders in a project.

    Scans existing family keys, extracts numeric ones, and returns
    ``str(max + 1)`` or ``"1"`` if none exist.
    """
    existing_keys = ChangeOrder.objects.filter(project=project).values_list("family_key", flat=True)
    numeric_keys = []
    for key in existing_keys:
        key_str = str(key or "").strip()
        if key_str.isdigit():
            numeric_keys.append(int(key_str))
    return str((max(numeric_keys) + 1) if numeric_keys else 1)


# ---------------------------------------------------------------------------
# PATCH concern handlers — called by the thin dispatcher in change_orders.py
# ---------------------------------------------------------------------------


def _handle_co_document_save(
    request: Request,
    change_order: ChangeOrder,
    data: dict[str, Any],
    membership: OrganizationMembership,
) -> Response:
    """Apply content field updates and line items to a change order (save concern).

    Handles title, reason, terms_text, amount_delta, days_delta,
    origin_quote, and line items with amount consistency validation.
    Enforces origin-quote immutability and line/amount-delta agreement.
    Does not perform status transitions or snapshot recording.
    """
    current_amount_delta = quantize_money(change_order.amount_delta)
    next_amount_delta = quantize_money(data.get("amount_delta", current_amount_delta))
    incoming_line_items = data.get("line_items", None)

    # Line item validation
    cost_code_map = {}
    if incoming_line_items is not None:
        cost_code_map, line_total_delta, line_error = _validate_change_order_lines(
            line_items=incoming_line_items,
            organization_id=membership.organization_id,
        )
        if line_error:
            return Response(line_error, status=400)
        if line_total_delta != next_amount_delta:
            return Response(
                {"error": {"code": "validation_error", "message": "Line-item total must match change-order amount delta.", "fields": {"line_items": ["Sum of line item amount_delta must equal amount_delta."]}}},
                status=400,
            )
    else:
        existing_line_total = (
            change_order.line_items.aggregate(total=Sum("amount_delta")).get("total")
            or Decimal("0.00")
        )
        if (
            "amount_delta" in data
            and existing_line_total != Decimal("0.00")
            and existing_line_total != next_amount_delta
        ):
            return Response(
                {"error": {"code": "validation_error", "message": "Existing line items no longer match amount delta.", "fields": {"amount_delta": ["Update line_items with amount_delta so total remains consistent."]}}},
                status=400,
            )

    # Origin quote validation
    update_fields = ["updated_at"]
    if "origin_quote" in data:
        if change_order.origin_quote_id and data["origin_quote"] != change_order.origin_quote_id:
            return Response(
                {"error": {"code": "validation_error", "message": "origin_quote cannot be changed after being set.", "fields": {"origin_quote": ["Create a new revision to change quote linkage."]}}},
                status=400,
            )
        if data["origin_quote"] is None:
            if change_order.origin_quote_id is not None:
                return Response(
                    {"error": {"code": "validation_error", "message": "origin_quote cannot be cleared once set.", "fields": {"origin_quote": ["Create a new revision to remove quote linkage."]}}},
                    status=400,
                )
        elif change_order.origin_quote_id is None:
            try:
                origin_quote = Quote.objects.get(
                    id=data["origin_quote"],
                    project=change_order.project,
                )
            except Quote.DoesNotExist:
                return Response(
                    {"error": {"code": "validation_error", "message": "origin_quote is invalid for this project.", "fields": {"origin_quote": ["Use an quote from this project."]}}},
                    status=400,
                )
            if origin_quote.status != Quote.Status.APPROVED:
                return Response(
                    {"error": {"code": "validation_error", "message": "Change orders require an approved origin quote.", "fields": {"origin_quote": ["Only approved quotes can be used as CO origin."]}}},
                    status=400,
                )
            change_order.origin_quote = origin_quote
            update_fields.append("origin_quote")

    # Field updates
    if "title" in data:
        change_order.title = data["title"]
        update_fields.append("title")
    if "amount_delta" in data:
        change_order.amount_delta = data["amount_delta"]
        update_fields.append("amount_delta")
    if "days_delta" in data:
        change_order.days_delta = data["days_delta"]
        update_fields.append("days_delta")
    if "reason" in data:
        change_order.reason = data["reason"]
        update_fields.append("reason")
    if "terms_text" in data:
        change_order.terms_text = data["terms_text"]
        update_fields.append("terms_text")
    if "status" in data:
        change_order.status = data["status"]
        update_fields.append("status")

    sections_data = data.get("sections")

    try:
        with transaction.atomic():
            if len(update_fields) > 1:
                change_order.save(update_fields=update_fields)
            if incoming_line_items is not None:
                _sync_change_order_lines(
                    change_order=change_order,
                    line_items=incoming_line_items,
                    cost_code_map=cost_code_map,
                    sections_data=sections_data,
                )
            elif sections_data is not None:
                # Sections changed without line items — recompute from existing lines.
                existing_lines = [
                    {"order": line.order, "amount_delta": line.amount_delta}
                    for line in change_order.line_items.all()
                ]
                ChangeOrderSection.objects.filter(change_order=change_order).delete()
                computed_sections = _compute_co_section_subtotals(sections_data, existing_lines)
                ChangeOrderSection.objects.bulk_create([
                    ChangeOrderSection(
                        change_order=change_order,
                        name=section["name"],
                        order=section["order"],
                        subtotal=section["subtotal"],
                    )
                    for section in computed_sections
                ])
    except ValidationError as exc:
        fields = exc.message_dict if hasattr(exc, "message_dict") else {"non_field_errors": exc.messages}
        return Response(
            {"error": {"code": "validation_error", "message": "Change-order line items are invalid for this project/budget context.", "fields": fields}},
            status=400,
        )

    refreshed = _prefetch_change_order_qs(ChangeOrder.objects.filter(id=change_order.id)).get()
    return Response({"data": ChangeOrderSerializer(refreshed, context={"request": request}).data, "email_sent": False})


def _handle_co_status_transition(
    request: Request,
    change_order: ChangeOrder,
    data: dict[str, Any],
    membership: OrganizationMembership,
    previous_status: str,
    next_status: str,
    is_resend: bool,
) -> Response:
    """Handle a change-order status transition with financials, audit, and email.

    Called when the PATCH includes a real status change or a
    sent resend.  Freezes org identity on draft departure,
    propagates financial deltas to the project contract value, manages
    approval metadata, records immutable snapshots, and sends email
    notifications on send/resend.
    """
    if not is_resend and not ChangeOrder.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        return Response(
            {"error": {"code": "validation_error", "message": f"Invalid change order status transition: {previous_status} -> {next_status}.", "fields": {"status": ["This transition is not allowed."]}}},
            status=400,
        )

    # Financial delta
    current_amount_delta = quantize_money(change_order.amount_delta)
    financial_delta = MONEY_ZERO
    if previous_status != ChangeOrder.Status.APPROVED and next_status == ChangeOrder.Status.APPROVED:
        financial_delta = current_amount_delta
    elif previous_status == ChangeOrder.Status.APPROVED and next_status != ChangeOrder.Status.APPROVED:
        financial_delta = quantize_money(current_amount_delta * Decimal("-1"))

    update_fields = ["status", "updated_at"]
    change_order.status = next_status

    # Freeze org identity onto the document when leaving draft so public
    # pages never fall back to live (potentially changed) org defaults.
    if previous_status == ChangeOrder.Status.DRAFT and next_status != ChangeOrder.Status.DRAFT:
        organization = membership.organization
        if not (change_order.terms_text or "").strip():
            org_terms = (organization.change_order_terms_and_conditions or "").strip()
            if org_terms:
                change_order.terms_text = org_terms
                if "terms_text" not in update_fields:
                    update_fields.append("terms_text")
        if not (change_order.sender_name or "").strip():
            org_name = (organization.display_name or "").strip()
            if org_name:
                change_order.sender_name = org_name
                if "sender_name" not in update_fields:
                    update_fields.append("sender_name")
        if not (change_order.sender_address or "").strip():
            org_address = organization.formatted_billing_address
            if org_address:
                change_order.sender_address = org_address
                if "sender_address" not in update_fields:
                    update_fields.append("sender_address")
        if not (change_order.sender_logo_url or "").strip():
            if organization.logo:
                change_order.sender_logo_url = request.build_absolute_uri(organization.logo.url)
                if "sender_logo_url" not in update_fields:
                    update_fields.append("sender_logo_url")

    # Approval metadata
    if previous_status != next_status and next_status == ChangeOrder.Status.APPROVED:
        change_order.approved_by = request.user
        change_order.approved_at = timezone.now()
        update_fields.extend(["approved_by", "approved_at"])
    elif previous_status != next_status and next_status != ChangeOrder.Status.APPROVED:
        if change_order.approved_by_id is not None:
            change_order.approved_by = None
            update_fields.append("approved_by")
        if change_order.approved_at is not None:
            change_order.approved_at = None
            update_fields.append("approved_at")

    try:
        with transaction.atomic():
            change_order.save(update_fields=update_fields)
            if financial_delta != MONEY_ZERO:
                Project.objects.filter(id=change_order.project_id).update(
                    contract_value_current=F("contract_value_current") + financial_delta,
                )
            if (
                previous_status != next_status
                and next_status in {
                    ChangeOrder.Status.APPROVED,
                    ChangeOrder.Status.REJECTED,
                    ChangeOrder.Status.VOID,
                }
            ):
                ChangeOrderSnapshot.record(
                    change_order=change_order,
                    decision_status=next_status,
                    previous_status=previous_status,
                    applied_financial_delta=financial_delta,
                    decided_by=request.user,
                )
            status_note = (data.get("status_note", "") or "").strip()
            event_note = status_note or ("Change order re-sent." if is_resend else "Change order status updated.")
            ChangeOrderStatusEvent.record(
                change_order=change_order,
                from_status=previous_status,
                to_status=next_status,
                note=event_note,
                changed_by=request.user,
            )
            logger.info("Change order status transition: id=%s CO-%s (%s → %s) delta=$%s by %s", change_order.id, change_order.family_key, previous_status, next_status, financial_delta, request.user.email)
    except ValidationError as exc:
        fields = exc.message_dict if hasattr(exc, "message_dict") else {"non_field_errors": exc.messages}
        return Response(
            {"error": {"code": "validation_error", "message": "Change-order line items are invalid for this project/budget context.", "fields": fields}},
            status=400,
        )

    # Email notification (outside transaction, async)
    email_sent = False
    notify_customer = data.get("notify_customer", True)
    if notify_customer and next_status == ChangeOrder.Status.SENT and (
        previous_status != ChangeOrder.Status.SENT or is_resend
    ):
        customer_email = (change_order.project.customer.email or "").strip()
        if customer_email:
            async_task(
                "core.tasks.send_document_sent_email_task",
                "Change Order",
                f"CO-{change_order.family_key}: {change_order.title}",
                f"{settings.FRONTEND_URL}/change-order/{change_order.public_ref}",
                customer_email,
                request.user.id,
            )
            email_sent = True

    refreshed = _prefetch_change_order_qs(ChangeOrder.objects.filter(id=change_order.id)).get()
    return Response({"data": ChangeOrderSerializer(refreshed, context={"request": request}).data, "email_sent": email_sent})


def _handle_co_status_note(
    request: Request,
    change_order: ChangeOrder,
    data: dict[str, Any],
) -> Response:
    """Record a status note without changing the change-order status.

    Creates a same-status audit event with the user's note, then returns
    the current document unchanged.
    """
    note_text = (data.get("status_note", "") or "").strip()

    with transaction.atomic():
        ChangeOrderStatusEvent.record(
            change_order=change_order,
            from_status=change_order.status,
            to_status=change_order.status,
            note=note_text,
            changed_by=request.user,
        )

    refreshed = _prefetch_change_order_qs(ChangeOrder.objects.filter(id=change_order.id)).get()
    return Response({"data": ChangeOrderSerializer(refreshed, context={"request": request}).data, "email_sent": False})
