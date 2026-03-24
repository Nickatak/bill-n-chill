"""Change-order policy contracts shared with UI consumers."""

from core.models import ChangeOrder

CHANGE_ORDER_POLICY_VERSION = "2026-02-24.change_orders.v8"


def _status_order() -> list[str]:
    return [status for status, _label in ChangeOrder.Status.choices]


def get_change_order_policy_contract() -> dict:
    """Return the canonical change-order workflow policy for UI consumers."""
    statuses = _status_order()
    status_index = {status: idx for idx, status in enumerate(statuses)}
    status_labels = {status: label for status, label in ChangeOrder.Status.choices}

    allowed_status_transitions = {}
    for status in statuses:
        next_statuses = list(ChangeOrder.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
        next_statuses.sort(key=lambda value: status_index.get(value, 999))
        allowed_status_transitions[status] = next_statuses

    terminal_statuses = [
        status for status in statuses if not allowed_status_transitions.get(status, [])
    ]

    editing_rules = {
        "edit_requires_draft_status": True,
    }
    origin_estimate_rules = {
        "required_on_create": True,
        "must_be_approved": True,
        "must_match_change_order_project": True,
        "immutable_once_set": True,
    }
    approval_metadata_rules = {
        "approved_requires_actor_and_timestamp": True,
        "non_approved_statuses_must_clear_actor_and_timestamp": True,
    }
    error_rules = {
        "co_create_missing_required_fields": "Create requires title and amount_delta.",
        "co_create_origin_estimate_required": "Create requires origin_estimate.",
        "co_origin_estimate_project_scope": "origin_estimate must belong to the same project.",
        "co_origin_estimate_approved_required": "origin_estimate must be approved.",
        "co_origin_estimate_immutable_once_set": "origin_estimate cannot change/clear once set.",
        "co_line_total_must_match_amount_delta": "Sum of line_items amount_delta must match change-order amount_delta.",
        "co_line_cost_code_invalid": "Each cost_code must exist and belong to the organization.",
        "co_edit_requires_draft_status": "Only draft change orders can edit content fields.",
        "co_status_transition_not_allowed": "Status transition must match allowed_status_transitions.",
        "co_approval_metadata_invariant": "approved_by/approved_at must match approved status invariants.",
    }

    return {
        "policy_version": CHANGE_ORDER_POLICY_VERSION,
        "status_labels": status_labels,
        "statuses": statuses,
        "default_create_status": ChangeOrder.Status.DRAFT,
        "allowed_status_transitions": allowed_status_transitions,
        "terminal_statuses": terminal_statuses,
        "editing_rules": editing_rules,
        "origin_estimate_rules": origin_estimate_rules,
        "approval_metadata_rules": approval_metadata_rules,
        "error_rules": error_rules,
    }
