"""Change-order policy contracts shared with UI clients."""

from core.models import ChangeOrder

CHANGE_ORDER_POLICY_VERSION = "2026-02-23.change_orders.v1"


def _status_order() -> list[str]:
    return [status for status, _label in ChangeOrder.Status.choices]


def get_change_order_policy_contract() -> dict:
    """Return the canonical change-order workflow policy for clients."""
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

    return {
        "policy_version": CHANGE_ORDER_POLICY_VERSION,
        "status_labels": status_labels,
        "statuses": statuses,
        "default_create_status": ChangeOrder.Status.DRAFT,
        "allowed_status_transitions": allowed_status_transitions,
        "terminal_statuses": terminal_statuses,
    }
