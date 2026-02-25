"""Invoice ingress adapter for normalizing external write payloads."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from core.models import InvoiceLine


def _normalize_invoice_line_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "line_type": item.get("line_type", InvoiceLine.LineType.SCOPE),
        "cost_code": item.get("cost_code"),
        "scope_item": item.get("scope_item"),
        "adjustment_reason": (item.get("adjustment_reason") or "").strip(),
        "internal_note": (item.get("internal_note") or "").strip(),
        "description": (item.get("description") or "").strip(),
        "quantity": item.get("quantity"),
        "unit": (item.get("unit") or "ea").strip() or "ea",
        "unit_price": item.get("unit_price"),
    }


@dataclass(frozen=True)
class InvoiceCreateIngress:
    issue_date: date
    due_date: date
    tax_percent: Decimal
    line_items: list[dict[str, Any]]


def build_invoice_create_ingress(
    validated_data: dict[str, Any],
    *,
    default_issue_date: date,
    default_due_date: date,
) -> InvoiceCreateIngress:
    line_items = [
        _normalize_invoice_line_item(item) for item in validated_data.get("line_items", [])
    ]
    return InvoiceCreateIngress(
        issue_date=validated_data.get("issue_date") or default_issue_date,
        due_date=validated_data.get("due_date") or default_due_date,
        tax_percent=validated_data.get("tax_percent", Decimal("0")),
        line_items=line_items,
    )


@dataclass(frozen=True)
class InvoicePatchIngress:
    has_status: bool
    status: str | None
    has_issue_date: bool
    issue_date: date | None
    has_due_date: bool
    due_date: date | None
    has_tax_percent: bool
    tax_percent: Decimal | None
    has_line_items: bool
    line_items: list[dict[str, Any]]
    scope_override: bool
    scope_override_note: str


def build_invoice_patch_ingress(validated_data: dict[str, Any]) -> InvoicePatchIngress:
    has_line_items = "line_items" in validated_data
    line_items = (
        [_normalize_invoice_line_item(item) for item in validated_data.get("line_items", [])]
        if has_line_items
        else []
    )
    return InvoicePatchIngress(
        has_status="status" in validated_data,
        status=validated_data.get("status"),
        has_issue_date="issue_date" in validated_data,
        issue_date=validated_data.get("issue_date"),
        has_due_date="due_date" in validated_data,
        due_date=validated_data.get("due_date"),
        has_tax_percent="tax_percent" in validated_data,
        tax_percent=validated_data.get("tax_percent"),
        has_line_items=has_line_items,
        line_items=line_items,
        scope_override=validated_data.get("scope_override", False),
        scope_override_note=validated_data.get("scope_override_note", ""),
    )
