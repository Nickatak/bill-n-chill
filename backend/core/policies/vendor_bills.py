"""Vendor-bill policy contracts shared with UI clients."""

from core.models import VendorBill

VENDOR_BILL_POLICY_VERSION = "2026-02-23.vendor_bills.v1"


def _status_order() -> list[str]:
    return [status for status, _label in VendorBill.Status.choices]


def get_vendor_bill_policy_contract() -> dict:
    """Return canonical vendor-bill workflow policy for clients."""
    statuses = _status_order()
    status_index = {status: idx for idx, status in enumerate(statuses)}
    status_labels = {status: label for status, label in VendorBill.Status.choices}

    allowed_status_transitions = {}
    for status in statuses:
        next_statuses = list(VendorBill.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
        next_statuses.sort(key=lambda value: status_index.get(value, 999))
        allowed_status_transitions[status] = next_statuses

    terminal_statuses = [
        status for status in statuses if not allowed_status_transitions.get(status, [])
    ]

    return {
        "policy_version": VENDOR_BILL_POLICY_VERSION,
        "status_labels": status_labels,
        "statuses": statuses,
        "default_create_status": VendorBill.Status.PLANNED,
        "create_shortcut_statuses": [VendorBill.Status.PLANNED, VendorBill.Status.RECEIVED],
        "allowed_status_transitions": allowed_status_transitions,
        "terminal_statuses": terminal_statuses,
    }
