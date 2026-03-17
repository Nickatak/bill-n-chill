"""Payment policy contracts shared with UI consumers."""

from core.models import Payment
from core.policies._base import _build_base_policy_contract

PAYMENT_POLICY_VERSION = "2026-03-05.payments.v2"


def get_payment_policy_contract() -> dict:
    """Return canonical payment workflow policy for UI consumers."""
    return _build_base_policy_contract(
        model_class=Payment,
        policy_version=PAYMENT_POLICY_VERSION,
        default_create_status=Payment.Status.SETTLED,
        extra_fields={
            "directions": [v for v, _l in Payment.Direction.choices],
            "methods": [v for v, _l in Payment.Method.choices],
            "default_create_direction": Payment.Direction.INBOUND,
            "default_create_method": Payment.Method.CHECK,
            "allocation_target_by_direction": {
                Payment.Direction.INBOUND: ["invoice"],
                Payment.Direction.OUTBOUND: ["vendor_bill", "receipt"],
            },
        },
    )
