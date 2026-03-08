"""Domain-specific helpers for change-order views."""

from decimal import Decimal

from django.core.exceptions import ValidationError
from rest_framework.response import Response

from core.models import BudgetLine, ChangeOrder, ChangeOrderLine, CostCode
from core.serializers import ChangeOrderSerializer
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    _active_budget_for_project,  # noqa: F401 — re-exported for change_orders.py
    _resolve_organization_for_public_actor,
    _serialize_public_organization_context,
    _serialize_public_project_context,
)


def _serialize_public_change_order(change_order) -> dict:
    """Serialize a change order with project and organization context for public preview."""
    serialized = ChangeOrderSerializer(change_order).data
    organization = _resolve_organization_for_public_actor(change_order.requested_by)
    serialized["project_context"] = _serialize_public_project_context(change_order.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization)
    if change_order.origin_estimate_id:
        serialized["origin_estimate_context"] = {
            "id": change_order.origin_estimate_id,
            "title": change_order.origin_estimate.title,
            "version": change_order.origin_estimate.version,
            "public_ref": change_order.origin_estimate.public_ref,
        }
    return serialized


def _validate_change_order_lines(*, project, line_items, organization_id):
    """Validate change order line items. Returns (budget_line_map, cost_code_map, total, error_response).

    'original' lines require a valid budget_line in the project's active budget.
    'new' lines require a valid cost_code in the organization.
    """
    if not line_items:
        return {}, {}, MONEY_ZERO, None

    # Collect referenced IDs by type.
    budget_line_ids = set()
    cost_code_ids = set()
    for row in line_items:
        line_type = row.get("line_type", ChangeOrderLine.LineType.ORIGINAL)
        if line_type == ChangeOrderLine.LineType.ORIGINAL:
            bl_id = row.get("budget_line")
            if not bl_id:
                return (
                    {}, {}, MONEY_ZERO,
                    _validation_error_response(
                        message="Original lines must reference a budget line.",
                        fields={"line_items": ["Provide budget_line for original lines."]},
                        rule="co_line_original_requires_budget_line",
                    ),
                )
            budget_line_ids.add(int(bl_id))
        elif line_type == ChangeOrderLine.LineType.NEW:
            cc_id = row.get("cost_code")
            if not cc_id:
                return (
                    {}, {}, MONEY_ZERO,
                    _validation_error_response(
                        message="New-scope lines must specify a cost code.",
                        fields={"line_items": ["Provide cost_code for new lines."]},
                        rule="co_line_new_requires_cost_code",
                    ),
                )
            cost_code_ids.add(int(cc_id))

    # Validate budget lines exist.
    budget_line_map = {}
    if budget_line_ids:
        budget_line_map = {
            row.id: row
            for row in BudgetLine.objects.select_related("budget", "cost_code").filter(
                id__in=budget_line_ids,
            )
        }
        if len(budget_line_map) != len(budget_line_ids):
            return (
                {}, {}, MONEY_ZERO,
                _validation_error_response(
                    message="One or more budget_line values are invalid.",
                    fields={"line_items": ["Use valid budget_line ids."]},
                    rule="co_line_budget_line_invalid",
                ),
            )

    # Validate cost codes exist and belong to the organization.
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
                {}, {}, MONEY_ZERO,
                _validation_error_response(
                    message="One or more cost_code values are invalid.",
                    fields={"line_items": ["Use valid cost_code ids."]},
                    rule="co_line_cost_code_invalid",
                ),
            )

    total = MONEY_ZERO
    for row in line_items:
        total = quantize_money(total + Decimal(str(row["amount_delta"])))
    return budget_line_map, cost_code_map, total, None


def _sync_change_order_lines(*, change_order, line_items, budget_line_map, cost_code_map):
    """Replace all line items on a change order with the provided set."""
    ChangeOrderLine.objects.filter(change_order=change_order).delete()
    for row in line_items:
        line_type = row.get("line_type", ChangeOrderLine.LineType.ORIGINAL)
        if line_type == ChangeOrderLine.LineType.ORIGINAL:
            budget_line = budget_line_map[int(row["budget_line"])]
            cost_code = None
        else:
            budget_line = None
            cost_code = cost_code_map[int(row["cost_code"])]
        ChangeOrderLine.objects.create(
            change_order=change_order,
            budget_line=budget_line,
            cost_code=cost_code,
            description=row.get("description", ""),
            line_type=line_type,
            adjustment_reason=str(row.get("adjustment_reason", "")).strip(),
            amount_delta=quantize_money(row["amount_delta"]),
            days_delta=row.get("days_delta", 0),
        )


def _create_budget_lines_for_new_scope(*, change_order, budget):
    """Create BudgetLine rows for 'new' type CO lines on approval.

    Called inside the atomic approval transaction. Each 'new' CO line
    materializes as a budget line with budget_amount = amount_delta.
    """
    new_lines = change_order.line_items.filter(
        line_type=ChangeOrderLine.LineType.NEW,
    ).select_related("cost_code")
    for co_line in new_lines:
        BudgetLine.objects.create(
            budget=budget,
            cost_code=co_line.cost_code,
            description=co_line.description or f"CO #{change_order.family_key} new scope",
            budget_amount=co_line.amount_delta,
        )


def _validation_error_response(*, message: str, fields: dict, rule: str | None = None):
    """Build a standard 400 validation error response with an optional rule code."""
    error = {
        "code": "validation_error",
        "message": message,
        "fields": fields,
    }
    if rule:
        error["rule"] = rule
    return Response({"error": error}, status=400)


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
    if {"budget_line", "line_items"} & field_keys:
        return "co_line_budget_line_invalid"
    if {"cost_code", "line_type"} & field_keys:
        return "co_line_cost_code_invalid"
    return None


def _model_validation_error_response(*, exc: ValidationError, message: str):
    """Convert a Django model ValidationError into a standard validation error response."""
    fields = {}
    if hasattr(exc, "message_dict"):
        fields = exc.message_dict
    else:
        fields = {"non_field_errors": exc.messages}
    return _validation_error_response(
        message=message,
        fields=fields,
        rule=_infer_model_validation_rule(fields=fields),
    )
