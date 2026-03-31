"""Organization-level default helpers for document branding/templates."""

from __future__ import annotations

from typing import Any

DEFAULT_INVOICE_DUE_DELTA = 30
DEFAULT_QUOTE_VALID_DELTA = 30
DEFAULT_INVOICE_TERMS = "Payment due within 30 days of invoice date."
DEFAULT_QUOTE_TERMS = (
    "Quote is valid for 30 days. Scope and pricing are based on visible conditions only; "
    "hidden conditions may require a change order."
)
DEFAULT_CHANGE_ORDER_TERMS = (
    "Change order pricing is based on current labor and material rates. "
    "Approved changes are final and will be reflected in the next billing cycle."
)


def build_org_defaults(*, owner_email: str = "") -> dict[str, Any]:
    """Build the default field values for a new or backfilled organization."""

    resolved_email = (owner_email or "").strip()
    return {
        "help_email": resolved_email,
        "default_invoice_due_delta": DEFAULT_INVOICE_DUE_DELTA,
        "default_quote_valid_delta": DEFAULT_QUOTE_VALID_DELTA,
        "invoice_terms_and_conditions": DEFAULT_INVOICE_TERMS,
        "quote_terms_and_conditions": DEFAULT_QUOTE_TERMS,
        "change_order_terms_and_conditions": DEFAULT_CHANGE_ORDER_TERMS,
    }


def apply_missing_org_defaults(*, organization, owner_email: str = "") -> list[str]:
    """Apply missing defaults to an existing organization in-memory.

    Returns the list of changed model field names; caller owns saving.
    """

    changed_fields: list[str] = []
    defaults = build_org_defaults(
        owner_email=owner_email,
    )

    current_help_email = (organization.help_email or "").strip()
    if not current_help_email and defaults["help_email"]:
        organization.help_email = defaults["help_email"]
        changed_fields.append("help_email")

    if int(organization.default_invoice_due_delta or 0) < 1:
        organization.default_invoice_due_delta = DEFAULT_INVOICE_DUE_DELTA
        changed_fields.append("default_invoice_due_delta")

    if int(organization.default_quote_valid_delta or 0) < 1:
        organization.default_quote_valid_delta = DEFAULT_QUOTE_VALID_DELTA
        changed_fields.append("default_quote_valid_delta")

    current_terms = (organization.invoice_terms_and_conditions or "").strip()
    if not current_terms:
        organization.invoice_terms_and_conditions = defaults["invoice_terms_and_conditions"]
        changed_fields.append("invoice_terms_and_conditions")

    current_quote_terms = (organization.quote_terms_and_conditions or "").strip()
    if not current_quote_terms:
        organization.quote_terms_and_conditions = defaults["quote_terms_and_conditions"]
        changed_fields.append("quote_terms_and_conditions")

    current_change_order_terms = (organization.change_order_terms_and_conditions or "").strip()
    if not current_change_order_terms:
        organization.change_order_terms_and_conditions = defaults["change_order_terms_and_conditions"]
        changed_fields.append("change_order_terms_and_conditions")

    return changed_fields
