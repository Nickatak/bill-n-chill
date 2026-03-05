"""Vendor-bill policy contracts shared with UI consumers."""

from core.models import VendorBill
from core.policies._base import _build_base_policy_contract

VENDOR_BILL_POLICY_VERSION = "2026-03-01.vendor_bills.v2"

# Compound transitions the view layer supports beyond the model's atomic map.
# received -> scheduled is a shortcut that atomically walks through approved.
COMPOUND_TRANSITIONS = {
    VendorBill.Status.RECEIVED: [VendorBill.Status.SCHEDULED],
}


def get_vendor_bill_policy_contract() -> dict:
    """Return canonical vendor-bill workflow policy for UI consumers."""
    return _build_base_policy_contract(
        model_class=VendorBill,
        policy_version=VENDOR_BILL_POLICY_VERSION,
        default_create_status=VendorBill.Status.PLANNED,
        extra_transitions=COMPOUND_TRANSITIONS,
        extra_fields={
            "create_shortcut_statuses": [
                VendorBill.Status.PLANNED,
                VendorBill.Status.RECEIVED,
            ],
        },
    )
