"""Domain-specific helpers for change-order views."""

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    ChangeOrderLine,
    ChangeOrderSnapshot,
    CostCode,
    Estimate,
    Project,
)
from core.serializers import ChangeOrderSerializer, EstimateLineItemSerializer
from core.utils.email import send_document_sent_email
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    _resolve_organization_for_public_actor,
    _serialize_public_organization_context,
    _serialize_public_project_context,
)


def _serialize_public_change_order(change_order, request=None) -> dict:
    """Serialize a change order with project and organization context for public preview.

    Includes origin estimate line items and approved sibling change orders for
    the contract breakdown section on the public document.
    """
    serialized = ChangeOrderSerializer(change_order).data
    organization = _resolve_organization_for_public_actor(change_order.requested_by)
    serialized["project_context"] = _serialize_public_project_context(change_order.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization, request=request)
    if change_order.origin_estimate_id:
        estimate = change_order.origin_estimate
        serialized["origin_estimate_context"] = {
            "id": estimate.id,
            "title": estimate.title,
            "version": estimate.version,
            "public_ref": estimate.public_ref,
            "grand_total": str(estimate.grand_total),
            "line_items": EstimateLineItemSerializer(
                estimate.line_items.select_related("cost_code").all(), many=True
            ).data,
        }
        # Approved/accepted sibling COs on the same origin estimate (excluding this CO).
        sibling_cos = (
            ChangeOrder.objects.filter(
                origin_estimate_id=estimate.id,
                status__in=["approved", "accepted"],
            )
            .exclude(id=change_order.id)
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("created_at", "id")
        )
        serialized["approved_sibling_change_orders"] = [
            ChangeOrderSerializer(co).data for co in sibling_cos
        ]
    return serialized


def _validate_change_order_lines(*, line_items, organization_id):
    """Validate change order line items. Returns (cost_code_map, total, error_response).

    Each line requires a valid cost_code in the organization.
    """
    if not line_items:
        return {}, MONEY_ZERO, None

    cost_code_ids = set()
    for row in line_items:
        cc_id = row.get("cost_code")
        if not cc_id:
            return (
                {}, MONEY_ZERO,
                _validation_error_payload(
                    message="Lines must specify a cost code.",
                    fields={"line_items": ["Provide cost_code for each line."]},
                    rule="co_line_requires_cost_code",
                ),
            )
        cost_code_ids.add(int(cc_id))

    cost_code_map = {}
    if cost_code_ids:
        cost_code_map = {
            row.id: row
            for row in CostCode.objects.filter(
                id__in=cost_code_ids,
                organization_id=organization_id,
            )
        }
        if len(cost_code_map) != len(cost_code_ids):
            return (
                {}, MONEY_ZERO,
                _validation_error_payload(
                    message="One or more cost_code values are invalid.",
                    fields={"line_items": ["Use valid cost_code ids."]},
                    rule="co_line_cost_code_invalid",
                ),
            )

    total = MONEY_ZERO
    for row in line_items:
        total = quantize_money(total + Decimal(str(row["amount_delta"])))
    return cost_code_map, total, None


def _sync_change_order_lines(*, change_order, line_items, cost_code_map):
    """Replace all line items on a change order with the provided set."""
    ChangeOrderLine.objects.filter(change_order=change_order).delete()
    for row in line_items:
        cost_code = cost_code_map.get(int(row["cost_code"])) if row.get("cost_code") else None
        ChangeOrderLine.objects.create(
            change_order=change_order,
            cost_code=cost_code,
            description=row.get("description", ""),
            adjustment_reason=str(row.get("adjustment_reason", "")).strip(),
            amount_delta=quantize_money(row["amount_delta"]),
            days_delta=row.get("days_delta", 0),
        )


def _validation_error_payload(*, message: str, fields: dict, rule: str | None = None):
    """Build a (body, status_code) tuple for a 400 validation error.

    Returns the raw payload and HTTP status so the calling view owns Response construction.
    """
    error = {
        "code": "validation_error",
        "message": message,
        "fields": fields,
    }
    if rule:
        error["rule"] = rule
    return {"error": error}, 400


def _next_change_order_family_key(*, project):
    """Return the next numeric family key string for change orders in a project."""
    existing_keys = ChangeOrder.objects.filter(project=project).values_list("family_key", flat=True)
    numeric_keys = []
    for key in existing_keys:
        key_str = str(key or "").strip()
        if key_str.isdigit():
            numeric_keys.append(int(key_str))
    return str((max(numeric_keys) + 1) if numeric_keys else 1)


def _infer_model_validation_rule(*, fields: dict) -> str | None:
    """Infer a domain-specific rule code from Django model ValidationError field names."""
    field_keys = set(fields.keys())
    if {"approved_by", "approved_at"} & field_keys:
        return "co_approval_metadata_invariant"
    if {"previous_change_order", "family_key", "revision_number"} & field_keys:
        return "co_revision_chain_invalid"
    if "status" in field_keys:
        return "co_status_transition_not_allowed"
    if "origin_estimate" in field_keys:
        return "co_origin_estimate_project_scope"
    if {"cost_code", "line_type"} & field_keys:
        return "co_line_cost_code_invalid"
    return None


def _model_validation_error_payload(*, exc: ValidationError, message: str):
    """Convert a Django model ValidationError into a (body, status_code) tuple.

    Returns the raw payload and HTTP status so the calling view owns Response construction.
    """
    fields = {}
    if hasattr(exc, "message_dict"):
        fields = exc.message_dict
    else:
        fields = {"non_field_errors": exc.messages}
    return _validation_error_payload(
        message=message,
        fields=fields,
        rule=_infer_model_validation_rule(fields=fields),
    )


# ---------------------------------------------------------------------------
# PATCH concern handlers — called by the thin dispatcher in change_orders.py
# ---------------------------------------------------------------------------


def _handle_co_document_save(request, change_order, data, membership):
    """Apply content field updates and line items to a change order (the 'save' concern).

    Handles title, reason, terms_text, amount_delta, days_delta, origin_estimate,
    and line items with amount consistency validation.  Does not perform status
    transitions, financial propagation, or snapshot recording.
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
            return Response(*line_error)
        if line_total_delta != next_amount_delta:
            return Response(*_validation_error_payload(
                message="Line-item total must match change-order amount delta.",
                fields={"line_items": ["Sum of line item amount_delta must equal amount_delta."]},
                rule="co_line_total_must_match_amount_delta",
            ))
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
            return Response(*_validation_error_payload(
                message="Existing line items no longer match amount delta.",
                fields={
                    "amount_delta": [
                        "Update line_items with amount_delta so total remains consistent.",
                    ]
                },
                rule="co_line_total_must_match_amount_delta",
            ))

    # Origin estimate validation
    update_fields = ["updated_at"]
    if "origin_estimate" in data:
        if change_order.origin_estimate_id and data["origin_estimate"] != change_order.origin_estimate_id:
            return Response(*_validation_error_payload(
                message="origin_estimate cannot be changed after being set.",
                fields={"origin_estimate": ["Create a new revision to change estimate linkage."]},
                rule="co_origin_estimate_immutable_once_set",
            ))
        if data["origin_estimate"] is None:
            if change_order.origin_estimate_id is not None:
                return Response(*_validation_error_payload(
                    message="origin_estimate cannot be cleared once set.",
                    fields={"origin_estimate": ["Create a new revision to remove estimate linkage."]},
                    rule="co_origin_estimate_immutable_once_set",
                ))
        elif change_order.origin_estimate_id is None:
            try:
                origin_estimate = Estimate.objects.get(
                    id=data["origin_estimate"],
                    project=change_order.project,
                )
            except Estimate.DoesNotExist:
                return Response(*_validation_error_payload(
                    message="origin_estimate is invalid for this project.",
                    fields={"origin_estimate": ["Use an estimate from this project."]},
                    rule="co_origin_estimate_project_scope",
                ))
            if origin_estimate.status != Estimate.Status.APPROVED:
                return Response(*_validation_error_payload(
                    message="Change orders require an approved origin estimate.",
                    fields={"origin_estimate": ["Only approved estimates can be used as CO origin."]},
                    rule="co_origin_estimate_approved_required",
                ))
            change_order.origin_estimate = origin_estimate
            update_fields.append("origin_estimate")

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

    try:
        with transaction.atomic():
            if len(update_fields) > 1:
                change_order.save(update_fields=update_fields)
            if incoming_line_items is not None:
                _sync_change_order_lines(
                    change_order=change_order,
                    line_items=incoming_line_items,
                    cost_code_map=cost_code_map,
                )
    except ValidationError as exc:
        return Response(*_model_validation_error_payload(
            exc=exc,
            message="Change-order line items are invalid for this project/budget context.",
        ))

    refreshed = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(refreshed).data, "email_sent": False})


def _handle_co_status_transition(
    request, change_order, data, membership, previous_status, next_status, is_resend,
):
    """Handle a change order status transition: validate, apply, propagate financials, audit, email.

    Called when the PATCH includes a real status change (previous != next) or a
    pending-approval resend.  Handles org identity freeze on draft departure,
    financial delta propagation to the project, approval metadata, snapshot
    recording, and email notification.
    """
    if not is_resend and not ChangeOrder.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        return Response(*_validation_error_payload(
            message=f"Invalid change order status transition: {previous_status} -> {next_status}.",
            fields={"status": ["This transition is not allowed."]},
            rule="co_status_transition_not_allowed",
        ))

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
    except ValidationError as exc:
        return Response(*_model_validation_error_payload(
            exc=exc,
            message="Change-order line items are invalid for this project/budget context.",
        ))

    # Email notification (outside transaction)
    email_sent = False
    if next_status == ChangeOrder.Status.PENDING_APPROVAL and (
        previous_status != ChangeOrder.Status.PENDING_APPROVAL or is_resend
    ):
        customer_email = (change_order.project.customer.email or "").strip()
        email_sent = send_document_sent_email(
            document_type="Change Order",
            document_title=f"CO-{change_order.family_key} v{change_order.revision_number}: {change_order.title}",
            public_url=f"{settings.FRONTEND_URL}/change-order/{change_order.public_ref}",
            recipient_email=customer_email,
            sender_user=request.user,
        )

    refreshed = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(refreshed).data, "email_sent": email_sent})


def _handle_co_status_note(request, change_order, data):
    """Return current change order state for note-only requests.

    Change orders do not store timeline notes — this handler exists for
    frontend call symmetry and returns the current document unchanged.
    """
    refreshed = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(refreshed).data, "email_sent": False})
