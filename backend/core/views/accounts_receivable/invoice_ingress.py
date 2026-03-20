"""Invoice ingress adapter for normalizing external write payloads."""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any


def _normalize_invoice_line_item(item: dict[str, Any]) -> dict[str, Any]:
    """Normalize and whitespace-strip a single invoice line item payload dict."""
    return {
        "cost_code": item.get("cost_code"),
        "description": (item.get("description") or "").strip(),
        "quantity": item.get("quantity"),
        "unit": (item.get("unit") or "ea").strip() or "ea",
        "unit_price": item.get("unit_price"),
    }


@dataclass(frozen=True)
class InvoiceCreateIngress:
    """Immutable ingress payload for invoice creation with defaults applied."""

    issue_date: date
    due_date: date
    sender_name: str
    sender_email: str
    sender_address: str
    sender_logo_url: str
    terms_text: str
    footer_text: str
    notes_text: str
    tax_percent: Decimal
    line_items: list[dict[str, Any]]


def build_invoice_create_ingress(
    validated_data: dict[str, Any],
    *,
    default_issue_date: date,
    default_due_days: int,
    default_sender_name: str,
    default_sender_email: str,
    default_sender_address: str,
    default_sender_logo_url: str,
    default_terms_text: str,
    default_footer_text: str,
    default_notes_text: str,
) -> InvoiceCreateIngress:
    """Build an InvoiceCreateIngress from validated request data, applying org defaults for missing fields."""
    line_items = [
        _normalize_invoice_line_item(line_item) for line_item in validated_data.get("line_items", [])
    ]
    issue_date = validated_data.get("issue_date") or default_issue_date
    due_date = validated_data.get("due_date") or (issue_date + timedelta(days=default_due_days))
    return InvoiceCreateIngress(
        issue_date=issue_date,
        due_date=due_date,
        sender_name=(validated_data.get("sender_name") or default_sender_name).strip(),
        sender_email=(validated_data.get("sender_email") or default_sender_email).strip(),
        sender_address=(validated_data.get("sender_address") or default_sender_address).strip(),
        sender_logo_url=(validated_data.get("sender_logo_url") or default_sender_logo_url).strip(),
        terms_text=(validated_data.get("terms_text") or default_terms_text).strip(),
        footer_text=(validated_data.get("footer_text") or default_footer_text).strip(),
        notes_text=(validated_data.get("notes_text") or default_notes_text).strip(),
        tax_percent=validated_data.get("tax_percent", Decimal("0")),
        line_items=line_items,
    )


@dataclass(frozen=True)
class InvoicePatchIngress:
    """Immutable ingress payload for invoice PATCH with per-field presence tracking."""

    has_status: bool
    status: str | None
    has_status_note: bool
    status_note: str
    has_issue_date: bool
    issue_date: date | None
    has_due_date: bool
    due_date: date | None
    has_sender_name: bool
    sender_name: str | None
    has_sender_email: bool
    sender_email: str | None
    has_sender_address: bool
    sender_address: str | None
    has_sender_logo_url: bool
    sender_logo_url: str | None
    has_terms_text: bool
    terms_text: str | None
    has_footer_text: bool
    footer_text: str | None
    has_notes_text: bool
    notes_text: str | None
    has_tax_percent: bool
    tax_percent: Decimal | None
    has_line_items: bool
    line_items: list[dict[str, Any]]


def build_invoice_patch_ingress(validated_data: dict[str, Any]) -> InvoicePatchIngress:
    """Build an InvoicePatchIngress from validated request data with has_* presence flags."""
    has_line_items = "line_items" in validated_data
    line_items = (
        [_normalize_invoice_line_item(line_item) for line_item in validated_data.get("line_items", [])]
        if has_line_items
        else []
    )
    return InvoicePatchIngress(
        has_status="status" in validated_data,
        status=validated_data.get("status"),
        has_status_note="status_note" in validated_data,
        status_note=(validated_data.get("status_note") or "").strip(),
        has_issue_date="issue_date" in validated_data,
        issue_date=validated_data.get("issue_date"),
        has_due_date="due_date" in validated_data,
        due_date=validated_data.get("due_date"),
        has_sender_name="sender_name" in validated_data,
        sender_name=validated_data.get("sender_name"),
        has_sender_email="sender_email" in validated_data,
        sender_email=validated_data.get("sender_email"),
        has_sender_address="sender_address" in validated_data,
        sender_address=validated_data.get("sender_address"),
        has_sender_logo_url="sender_logo_url" in validated_data,
        sender_logo_url=validated_data.get("sender_logo_url"),
        has_terms_text="terms_text" in validated_data,
        terms_text=validated_data.get("terms_text"),
        has_footer_text="footer_text" in validated_data,
        footer_text=validated_data.get("footer_text"),
        has_notes_text="notes_text" in validated_data,
        notes_text=validated_data.get("notes_text"),
        has_tax_percent="tax_percent" in validated_data,
        tax_percent=validated_data.get("tax_percent"),
        has_line_items=has_line_items,
        line_items=line_items,
    )
