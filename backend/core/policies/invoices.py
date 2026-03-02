"""Invoice policy contracts shared with UI consumers."""

from core.models import Invoice

INVOICE_POLICY_VERSION = "2026-03-01.invoices.v3"


def _status_order() -> list[str]:
    return [status for status, _label in Invoice.Status.choices]


def get_invoice_policy_contract() -> dict:
    """Return canonical invoice workflow policy for UI consumers."""
    statuses = _status_order()
    status_index = {status: idx for idx, status in enumerate(statuses)}
    status_labels = {status: label for status, label in Invoice.Status.choices}

    allowed_status_transitions = {}
    for status in statuses:
        next_statuses = list(Invoice.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
        next_statuses.sort(key=lambda value: status_index.get(value, 999))
        allowed_status_transitions[status] = next_statuses

    terminal_statuses = [
        status for status in statuses if not allowed_status_transitions.get(status, [])
    ]

    return {
        "policy_version": INVOICE_POLICY_VERSION,
        "status_labels": status_labels,
        "statuses": statuses,
        "default_create_status": Invoice.Status.DRAFT,
        "default_status_filters": [
            Invoice.Status.DRAFT,
            Invoice.Status.SENT,
            Invoice.Status.PARTIALLY_PAID,
        ],
        "allowed_status_transitions": allowed_status_transitions,
        "terminal_statuses": terminal_statuses,
        "scope_guard_rules": {
            "billable_statuses": [
                Invoice.Status.SENT,
                Invoice.Status.PARTIALLY_PAID,
                Invoice.Status.PAID,
            ],
            "scope_override_event_required_for_out_of_scope_billable": True,
        },
    }
