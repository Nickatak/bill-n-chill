"""Tests for the invoice ingress adapter (pure logic, no DB)."""

from datetime import date
from decimal import Decimal
from unittest import TestCase

from core.views.accounts_receivable.invoice_ingress import (
    build_invoice_create_ingress,
    build_invoice_patch_ingress,
    _normalize_invoice_line_item,
)


class NormalizeLineItemTests(TestCase):
    def test_strips_whitespace(self):
        item = _normalize_invoice_line_item({
            "description": "  Drywall  ",
            "unit": "  sqft  ",
            "cost_code": 1,
            "quantity": 10,
            "unit_price": "5.00",
        })
        self.assertEqual(item["description"], "Drywall")
        self.assertEqual(item["unit"], "sqft")

    def test_defaults_unit_to_ea(self):
        item = _normalize_invoice_line_item({"unit_price": "1.00"})
        self.assertEqual(item["unit"], "ea")

    def test_blank_unit_defaults_to_ea(self):
        item = _normalize_invoice_line_item({"unit": "", "unit_price": "1.00"})
        self.assertEqual(item["unit"], "ea")

    def test_preserves_cost_code_and_quantity(self):
        item = _normalize_invoice_line_item({
            "cost_code": 42,
            "quantity": 3,
            "unit_price": "10.00",
        })
        self.assertEqual(item["cost_code"], 42)
        self.assertEqual(item["quantity"], 3)


class BuildInvoiceCreateIngressTests(TestCase):
    def _defaults(self):
        return {
            "default_issue_date": date(2026, 4, 1),
            "default_due_days": 30,
            "default_sender_name": "Default Co",
            "default_sender_address": "1 Default St",
            "default_sender_logo_url": "https://example.com/logo.png",
            "default_terms_text": "Net 30",
            "default_footer_text": "Thank you",
            "default_notes_text": "",
        }

    def test_applies_defaults_for_missing_fields(self):
        ingress = build_invoice_create_ingress(
            {"line_items": [{"unit_price": "10.00"}]},
            **self._defaults(),
        )
        self.assertEqual(ingress.issue_date, date(2026, 4, 1))
        self.assertEqual(ingress.due_date, date(2026, 5, 1))
        self.assertEqual(ingress.sender_name, "Default Co")
        self.assertEqual(ingress.sender_address, "1 Default St")
        self.assertEqual(ingress.terms_text, "Net 30")
        self.assertEqual(ingress.initial_status, "draft")
        self.assertIsNone(ingress.related_quote_id)
        self.assertIsNone(ingress.billing_period_id)

    def test_explicit_values_override_defaults(self):
        ingress = build_invoice_create_ingress(
            {
                "issue_date": date(2026, 3, 15),
                "due_date": date(2026, 4, 15),
                "sender_name": "  Custom Co  ",
                "terms_text": "  Due on receipt  ",
                "initial_status": "sent",
                "related_quote": 7,
                "billing_period": 3,
                "line_items": [],
            },
            **self._defaults(),
        )
        self.assertEqual(ingress.issue_date, date(2026, 3, 15))
        self.assertEqual(ingress.due_date, date(2026, 4, 15))
        self.assertEqual(ingress.sender_name, "Custom Co")
        self.assertEqual(ingress.terms_text, "Due on receipt")
        self.assertEqual(ingress.initial_status, "sent")
        self.assertEqual(ingress.related_quote_id, 7)
        self.assertEqual(ingress.billing_period_id, 3)

    def test_due_date_computed_from_issue_date_when_omitted(self):
        ingress = build_invoice_create_ingress(
            {"issue_date": date(2026, 6, 1), "line_items": []},
            **self._defaults(),
        )
        self.assertEqual(ingress.due_date, date(2026, 7, 1))

    def test_line_items_normalized(self):
        ingress = build_invoice_create_ingress(
            {"line_items": [
                {"description": "  Item A  ", "unit": "  ft  ", "unit_price": "5.00"},
                {"description": "Item B", "unit_price": "10.00"},
            ]},
            **self._defaults(),
        )
        self.assertEqual(len(ingress.line_items), 2)
        self.assertEqual(ingress.line_items[0]["description"], "Item A")
        self.assertEqual(ingress.line_items[0]["unit"], "ft")
        self.assertEqual(ingress.line_items[1]["unit"], "ea")

    def test_tax_percent_defaults_to_zero(self):
        ingress = build_invoice_create_ingress(
            {"line_items": []},
            **self._defaults(),
        )
        self.assertEqual(ingress.tax_percent, Decimal("0"))

    def test_ingress_is_immutable(self):
        ingress = build_invoice_create_ingress(
            {"line_items": []},
            **self._defaults(),
        )
        with self.assertRaises(AttributeError):
            ingress.sender_name = "changed"


class BuildInvoicePatchIngressTests(TestCase):
    def test_empty_data_has_no_fields(self):
        ingress = build_invoice_patch_ingress({})
        self.assertFalse(ingress.has_status)
        self.assertFalse(ingress.has_status_note)
        self.assertFalse(ingress.has_issue_date)
        self.assertFalse(ingress.has_line_items)
        self.assertFalse(ingress.has_terms_text)
        self.assertFalse(ingress.has_tax_percent)

    def test_present_fields_tracked(self):
        ingress = build_invoice_patch_ingress({
            "status": "sent",
            "issue_date": date(2026, 5, 1),
            "line_items": [{"unit_price": "1.00"}],
        })
        self.assertTrue(ingress.has_status)
        self.assertEqual(ingress.status, "sent")
        self.assertTrue(ingress.has_issue_date)
        self.assertEqual(ingress.issue_date, date(2026, 5, 1))
        self.assertTrue(ingress.has_line_items)
        self.assertEqual(len(ingress.line_items), 1)
        self.assertFalse(ingress.has_terms_text)

    def test_status_note_stripped(self):
        ingress = build_invoice_patch_ingress({"status_note": "  hello  "})
        self.assertTrue(ingress.has_status_note)
        self.assertEqual(ingress.status_note, "hello")

    def test_none_status_note_becomes_empty(self):
        ingress = build_invoice_patch_ingress({"status_note": None})
        self.assertEqual(ingress.status_note, "")

    def test_line_items_normalized_on_patch(self):
        ingress = build_invoice_patch_ingress({
            "line_items": [{"description": "  Trim  ", "unit": "", "unit_price": "3.00"}],
        })
        self.assertEqual(ingress.line_items[0]["description"], "Trim")
        self.assertEqual(ingress.line_items[0]["unit"], "ea")

    def test_ingress_is_immutable(self):
        ingress = build_invoice_patch_ingress({"status": "draft"})
        with self.assertRaises(AttributeError):
            ingress.status = "sent"
