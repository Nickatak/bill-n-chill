"""Domain-specific helpers for change-order views."""

from decimal import Decimal

from django.core.exceptions import ValidationError
from rest_framework.response import Response

from core.models import Budget, BudgetLine, ChangeOrder, ChangeOrderLine
from core.serializers import ChangeOrderSerializer
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    SYSTEM_BUDGET_LINE_CODES,
    _organization_user_ids,
    _resolve_organization_for_public_actor,
    _serialize_public_organization_context,
    _serialize_public_project_context,
)


def _build_public_decision_note(
    *,
    action_label: str,
    note: str,
    decider_name: str,
    decider_email: str,
) -> str:
    actor_parts = [part for part in [decider_name.strip(), decider_email.strip()] if part]
    actor_label = " / ".join(actor_parts) if actor_parts else "anonymous customer"
    note_value = note.strip()
    if note_value:
        return f"{action_label} via public link by {actor_label}. {note_value}"
    return f"{action_label} via public link by {actor_label}."


def _serialize_public_change_order(change_order) -> dict:
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


def _validate_change_order_lines(*, project, line_items):
    if not line_items:
        return {}, MONEY_ZERO, None

    budget_line_ids = [int(row["budget_line"]) for row in line_items]
    unique_budget_line_ids = set(budget_line_ids)
    if len(unique_budget_line_ids) != len(budget_line_ids):
        return (
            {},
            MONEY_ZERO,
            _validation_error_response(
                message="Duplicate budget lines are not allowed within a change order.",
                fields={"line_items": ["Use each budget_line at most once."]},
                rule="co_line_duplicate_budget_line",
            ),
        )

    line_map = {
        row.id: row
        for row in BudgetLine.objects.select_related("budget", "cost_code").filter(
            id__in=unique_budget_line_ids,
        )
    }
    if len(line_map) != len(unique_budget_line_ids):
        return (
            {},
            MONEY_ZERO,
            _validation_error_response(
                message="One or more line_items budget_line values are invalid.",
                fields={"line_items": ["Use valid budget_line ids."]},
                rule="co_line_budget_line_invalid",
            ),
        )

    total = MONEY_ZERO
    for row in line_items:
        budget_line_id = int(row["budget_line"])
        budget_line = line_map[budget_line_id]
        line_type = row.get("line_type", ChangeOrderLine.LineType.SCOPE)
        adjustment_reason = str(row.get("adjustment_reason", "")).strip()

        if line_type == ChangeOrderLine.LineType.SCOPE:
            if (
                budget_line.cost_code
                and budget_line.cost_code.code in SYSTEM_BUDGET_LINE_CODES
            ):
                return (
                    {},
                    MONEY_ZERO,
                    _validation_error_response(
                        message="Scope lines cannot use internal generic budget lines.",
                        fields={"line_items": ["Scope lines must use estimate-derived budget lines."]},
                        rule="co_line_scope_budget_line_disallows_generic",
                    ),
                )
        elif line_type == ChangeOrderLine.LineType.ADJUSTMENT:
            if not adjustment_reason:
                return (
                    {},
                    MONEY_ZERO,
                    _validation_error_response(
                        message="Adjustment lines require adjustment_reason.",
                        fields={"line_items": ["Provide adjustment_reason for adjustment lines."]},
                        rule="co_line_adjustment_requires_reason",
                    ),
                )
            if (
                not budget_line.cost_code
                or budget_line.cost_code.code not in SYSTEM_BUDGET_LINE_CODES
            ):
                return (
                    {},
                    MONEY_ZERO,
                    _validation_error_response(
                        message="Adjustment lines must use generic adjustment budget lines.",
                        fields={"line_items": ["Adjustment lines must target a generic system budget line."]},
                        rule="co_line_adjustment_requires_generic_budget_line",
                    ),
                )

        total = quantize_money(total + Decimal(str(row["amount_delta"])))
    return line_map, total, None


def _sync_change_order_lines(*, change_order, line_items, line_map):
    ChangeOrderLine.objects.filter(change_order=change_order).delete()
    for row in line_items:
        ChangeOrderLine.objects.create(
            change_order=change_order,
            budget_line=line_map[int(row["budget_line"])],
            description=row.get("description", ""),
            line_type=row.get("line_type", ChangeOrderLine.LineType.SCOPE),
            adjustment_reason=str(row.get("adjustment_reason", "")).strip(),
            amount_delta=quantize_money(row["amount_delta"]),
            days_delta=row.get("days_delta", 0),
        )


def _validation_error_response(*, message: str, fields: dict, rule: str | None = None):
    error = {
        "code": "validation_error",
        "message": message,
        "fields": fields,
    }
    if rule:
        error["rule"] = rule
    return Response({"error": error}, status=400)


def _next_change_order_family_key(*, project):
    existing_keys = ChangeOrder.objects.filter(project=project).values_list("family_key", flat=True)
    numeric_keys = []
    for key in existing_keys:
        key_str = str(key or "").strip()
        if key_str.isdigit():
            numeric_keys.append(int(key_str))
    return str((max(numeric_keys) + 1) if numeric_keys else 1)


def _get_active_budget_for_project(*, project, user):
    actor_user_ids = _organization_user_ids(user)
    return (
        Budget.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
            status=Budget.Status.ACTIVE,
        )
        .order_by("-created_at")
        .first()
    )


def _infer_model_validation_rule(*, fields: dict) -> str | None:
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
    if {"adjustment_reason", "line_type"} & field_keys:
        return "co_line_adjustment_requires_reason"
    return None


def _model_validation_error_response(*, exc: ValidationError, message: str):
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
