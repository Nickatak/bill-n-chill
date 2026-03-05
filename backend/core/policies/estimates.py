"""Estimate policy contracts shared with UI consumers."""

from core.models import Estimate
from core.policies._base import _build_base_policy_contract

ESTIMATE_POLICY_VERSION = "2026-02-24.estimates.v3"


def get_estimate_policy_contract() -> dict:
    """Return canonical estimate workflow policy for UI consumers."""
    return _build_base_policy_contract(
        model_class=Estimate,
        policy_version=ESTIMATE_POLICY_VERSION,
        default_create_status=Estimate.Status.DRAFT,
        extra_fields={
            "default_status_filters": [
                Estimate.Status.DRAFT,
                Estimate.Status.SENT,
                Estimate.Status.APPROVED,
                Estimate.Status.REJECTED,
            ],
            "quick_action_by_status": {
                Estimate.Status.APPROVED: "change_order",
                Estimate.Status.REJECTED: "revision",
                Estimate.Status.VOID: "revision",
            },
        },
    )
