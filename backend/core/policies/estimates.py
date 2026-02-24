"""Estimate policy contracts shared with UI consumers."""

from core.models import Estimate

ESTIMATE_POLICY_VERSION = "2026-02-24.estimates.v2"


def _status_order() -> list[str]:
    return [status for status, _label in Estimate.Status.choices]


def get_estimate_policy_contract() -> dict:
    """Return canonical estimate workflow policy for UI consumers."""
    statuses = _status_order()
    status_index = {status: idx for idx, status in enumerate(statuses)}
    status_labels = {status: label for status, label in Estimate.Status.choices}

    allowed_status_transitions = {}
    for status in statuses:
        next_statuses = list(Estimate.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
        next_statuses.sort(key=lambda value: status_index.get(value, 999))
        allowed_status_transitions[status] = next_statuses

    terminal_statuses = [
        status for status in statuses if not allowed_status_transitions.get(status, [])
    ]

    return {
        "policy_version": ESTIMATE_POLICY_VERSION,
        "status_labels": status_labels,
        "statuses": statuses,
        "default_create_status": Estimate.Status.DRAFT,
        "default_status_filters": [
            Estimate.Status.DRAFT,
            Estimate.Status.SENT,
            Estimate.Status.APPROVED,
            Estimate.Status.REJECTED,
        ],
        "allowed_status_transitions": allowed_status_transitions,
        "terminal_statuses": terminal_statuses,
        "quick_action_by_status": {
            Estimate.Status.APPROVED: "change_order",
            Estimate.Status.REJECTED: "revision",
            Estimate.Status.ARCHIVED: "revision",
        },
    }
