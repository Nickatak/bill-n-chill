"""Vendor-bill policy contracts shared with UI consumers."""

from core.models import VendorBill
from core.policies._base import _build_base_policy_contract

VENDOR_BILL_POLICY_VERSION = "2026-03-18.vendor_bills.v6"


def get_vendor_bill_policy_contract() -> dict:
    """Return canonical vendor-bill workflow policy for UI consumers."""
    return _build_base_policy_contract(
        model_class=VendorBill,
        policy_version=VENDOR_BILL_POLICY_VERSION,
        default_create_status=VendorBill.Status.OPEN,
        extra_fields={},
    )
