"""Payment policy contracts shared with UI clients."""

from core.models import Payment

PAYMENT_POLICY_VERSION = "2026-02-23.payments.v1"


def _choice_values(choices) -> list[str]:
    return [value for value, _label in choices]


def get_payment_policy_contract() -> dict:
    """Return canonical payment workflow policy for clients."""
    statuses = _choice_values(Payment.Status.choices)
    status_index = {status: idx for idx, status in enumerate(statuses)}
    status_labels = {value: label for value, label in Payment.Status.choices}

    allowed_status_transitions = {}
    for status in statuses:
        next_statuses = list(Payment.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
        next_statuses.sort(key=lambda value: status_index.get(value, 999))
        allowed_status_transitions[status] = next_statuses

    terminal_statuses = [
        status for status in statuses if not allowed_status_transitions.get(status, [])
    ]

    return {
        "policy_version": PAYMENT_POLICY_VERSION,
        "status_labels": status_labels,
        "statuses": statuses,
        "directions": _choice_values(Payment.Direction.choices),
        "methods": _choice_values(Payment.Method.choices),
        "default_create_status": Payment.Status.PENDING,
        "default_create_direction": Payment.Direction.INBOUND,
        "default_create_method": Payment.Method.ACH,
        "allowed_status_transitions": allowed_status_transitions,
        "terminal_statuses": terminal_statuses,
        "allocation_target_by_direction": {
            Payment.Direction.INBOUND: "invoice",
            Payment.Direction.OUTBOUND: "vendor_bill",
        },
    }
