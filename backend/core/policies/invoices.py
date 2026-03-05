"""Invoice policy contracts shared with UI consumers."""

from core.models import Invoice
from core.policies._base import _build_base_policy_contract

INVOICE_POLICY_VERSION = "2026-03-01.invoices.v3"


def get_invoice_policy_contract() -> dict:
    """Return canonical invoice workflow policy for UI consumers."""
    return _build_base_policy_contract(
        model_class=Invoice,
        policy_version=INVOICE_POLICY_VERSION,
        default_create_status=Invoice.Status.DRAFT,
        extra_fields={
            "default_status_filters": [
                Invoice.Status.DRAFT,
                Invoice.Status.SENT,
                Invoice.Status.PARTIALLY_PAID,
            ],
            "scope_guard_rules": {
                "billable_statuses": [
                    Invoice.Status.SENT,
                    Invoice.Status.PARTIALLY_PAID,
                    Invoice.Status.PAID,
                ],
                "scope_override_event_required_for_out_of_scope_billable": True,
            },
        },
    )
