"""Domain-specific helpers for change-order views."""

from decimal import Decimal

from django.core.exceptions import ValidationError
from core.models import ChangeOrder, ChangeOrderLine, CostCode
from core.serializers import ChangeOrderSerializer, EstimateLineItemSerializer
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
