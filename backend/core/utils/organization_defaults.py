"""Organization-level default helpers for document branding/templates."""

from __future__ import annotations

from typing import Any

DEFAULT_INVOICE_DUE_DAYS = 30
DEFAULT_ESTIMATE_VALIDATION_DELTA_DAYS = 30
DEFAULT_INVOICE_TERMS = "Payment due within 30 days of invoice date."
DEFAULT_ESTIMATE_TERMS = (
    "Estimate is valid for 30 days. Scope and pricing are based on visible conditions only; "
    "hidden conditions may require a change order."
)
DEFAULT_CHANGE_ORDER_REASON = (
    "Scope adjustment requested after baseline approval due to field conditions or owner request."
)
DEFAULT_INVOICE_FOOTER = "Thank you for your business."
DEFAULT_INVOICE_NOTES = "Please include invoice number with your payment."


def build_invoice_profile_defaults(*, display_name: str, owner_email: str = "") -> dict[str, Any]:
    """Build bootstrap invoice defaults for a freshly created organization."""

    resolved_display_name = (display_name or "").strip()
    resolved_email = (owner_email or "").strip()
    return {
        "invoice_sender_name": resolved_display_name,
        "invoice_sender_email": resolved_email,
        "invoice_default_due_days": DEFAULT_INVOICE_DUE_DAYS,
        "estimate_validation_delta_days": DEFAULT_ESTIMATE_VALIDATION_DELTA_DAYS,
        "invoice_default_terms": DEFAULT_INVOICE_TERMS,
        "estimate_default_terms": DEFAULT_ESTIMATE_TERMS,
        "change_order_default_reason": DEFAULT_CHANGE_ORDER_REASON,
        "invoice_default_footer": DEFAULT_INVOICE_FOOTER,
        "invoice_default_notes": DEFAULT_INVOICE_NOTES,
    }


def apply_missing_invoice_profile_defaults(*, organization, owner_email: str = "") -> list[str]:
    """Apply missing invoice defaults to an existing organization in-memory.

    Returns the list of changed model field names; caller owns saving.
    """

    changed_fields: list[str] = []
    defaults = build_invoice_profile_defaults(
        display_name=organization.display_name,
        owner_email=owner_email,
    )

    current_sender_name = (organization.invoice_sender_name or "").strip()
    if not current_sender_name and defaults["invoice_sender_name"]:
        organization.invoice_sender_name = defaults["invoice_sender_name"]
        changed_fields.append("invoice_sender_name")

    current_sender_email = (organization.invoice_sender_email or "").strip()
    if not current_sender_email and defaults["invoice_sender_email"]:
        organization.invoice_sender_email = defaults["invoice_sender_email"]
        changed_fields.append("invoice_sender_email")

    if int(organization.invoice_default_due_days or 0) < 1:
        organization.invoice_default_due_days = DEFAULT_INVOICE_DUE_DAYS
        changed_fields.append("invoice_default_due_days")

    if int(organization.estimate_validation_delta_days or 0) < 1:
        organization.estimate_validation_delta_days = DEFAULT_ESTIMATE_VALIDATION_DELTA_DAYS
        changed_fields.append("estimate_validation_delta_days")

    current_terms = (organization.invoice_default_terms or "").strip()
    if not current_terms:
        organization.invoice_default_terms = defaults["invoice_default_terms"]
        changed_fields.append("invoice_default_terms")

    current_estimate_terms = (organization.estimate_default_terms or "").strip()
    if not current_estimate_terms:
        organization.estimate_default_terms = defaults["estimate_default_terms"]
        changed_fields.append("estimate_default_terms")

    current_change_order_reason = (organization.change_order_default_reason or "").strip()
    if not current_change_order_reason:
        organization.change_order_default_reason = defaults["change_order_default_reason"]
        changed_fields.append("change_order_default_reason")

    current_footer = (organization.invoice_default_footer or "").strip()
    if not current_footer:
        organization.invoice_default_footer = defaults["invoice_default_footer"]
        changed_fields.append("invoice_default_footer")

    current_notes = (organization.invoice_default_notes or "").strip()
    if not current_notes:
        organization.invoice_default_notes = defaults["invoice_default_notes"]
        changed_fields.append("invoice_default_notes")

    return changed_fields
