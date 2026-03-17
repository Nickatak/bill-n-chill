"""Vendor-bill policy contracts shared with UI consumers."""

from core.models import VendorBill
from core.policies._base import _build_base_policy_contract

VENDOR_BILL_POLICY_VERSION = "2026-03-16.vendor_bills.v4"


def get_vendor_bill_policy_contract() -> dict:
    """Return canonical vendor-bill workflow policy for UI consumers."""
    contract = _build_base_policy_contract(
        model_class=VendorBill,
        policy_version=VENDOR_BILL_POLICY_VERSION,
        default_create_status=VendorBill.Status.RECEIVED,
        extra_fields={},
    )
    contract["kinds"] = [k.value for k in VendorBill.Kind]
    contract["kind_labels"] = {k.value: k.label for k in VendorBill.Kind}
    return contract
