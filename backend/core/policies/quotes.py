"""Quote policy contracts shared with UI consumers."""

from core.models import Quote
from core.policies._base import _build_base_policy_contract

QUOTE_POLICY_VERSION = "2026-02-24.quotes.v3"


def get_quote_policy_contract() -> dict:
    """Return canonical quote workflow policy for UI consumers."""
    return _build_base_policy_contract(
        model_class=Quote,
        policy_version=QUOTE_POLICY_VERSION,
        default_create_status=Quote.Status.DRAFT,
        extra_fields={
            "default_status_filters": [
                Quote.Status.DRAFT,
                Quote.Status.SENT,
                Quote.Status.APPROVED,
                Quote.Status.REJECTED,
            ],
            "quick_action_by_status": {
                Quote.Status.APPROVED: "change_order",
                Quote.Status.REJECTED: "revision",
                Quote.Status.VOID: "revision",
            },
        },
    )
