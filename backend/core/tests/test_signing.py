"""Tests for signing ceremony utilities — content hashing, consent text, email masking."""

from unittest import TestCase

from core.utils.signing import (
    CEREMONY_CONSENT_TEXT,
    CEREMONY_CONSENT_TEXT_VERSION,
    compute_consent_text_version,
    compute_document_content_hash,
    mask_email,
    _extract_line_items,
)


class ConsentTextTests(TestCase):
    def test_version_is_sha256_hex(self):
        self.assertEqual(len(CEREMONY_CONSENT_TEXT_VERSION), 64)

    def test_version_is_deterministic(self):
        self.assertEqual(
            compute_consent_text_version(CEREMONY_CONSENT_TEXT),
            CEREMONY_CONSENT_TEXT_VERSION,
        )

    def test_different_text_produces_different_version(self):
        self.assertNotEqual(
            compute_consent_text_version("different text"),
            CEREMONY_CONSENT_TEXT_VERSION,
        )


class ExtractLineItemsTests(TestCase):
    def test_extracts_specified_fields(self):
        data = {
            "line_items": [
                {"description": "Lumber", "quantity": 10, "unit_price": "5.00", "id": 1, "created_at": "2026-01-01"},
                {"description": "Nails", "quantity": 100, "unit_price": "0.10", "id": 2},
            ]
        }
        result = _extract_line_items(data, ("description", "quantity", "unit_price"))
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0], {"description": "Lumber", "quantity": 10, "unit_price": "5.00"})
        self.assertNotIn("id", result[0])
        self.assertNotIn("created_at", result[0])

    def test_missing_fields_become_none(self):
        data = {"line_items": [{"description": "Partial"}]}
        result = _extract_line_items(data, ("description", "quantity"))
        self.assertEqual(result[0], {"description": "Partial", "quantity": None})

    def test_empty_line_items(self):
        self.assertEqual(_extract_line_items({"line_items": []}, ("description",)), [])

    def test_missing_line_items_key(self):
        self.assertEqual(_extract_line_items({}, ("description",)), [])


class ComputeDocumentContentHashTests(TestCase):
    def test_quote_hash_is_deterministic(self):
        data = {
            "title": "Kitchen Remodel",
            "version": 1,
            "tax_percent": "8.25",
            "terms_text": "Net 30",
            "line_items": [
                {"description": "Demo", "quantity": 1, "unit_price": "500.00",
                 "markup_percent": "0", "cost_code": None, "unit": "ea"},
            ],
        }
        hash1 = compute_document_content_hash("quote", data)
        hash2 = compute_document_content_hash("quote", data)
        self.assertEqual(hash1, hash2)
        self.assertEqual(len(hash1), 64)

    def test_quote_hash_excludes_volatile_fields(self):
        base = {
            "title": "Bathroom", "version": 1, "tax_percent": "0",
            "terms_text": "", "line_items": [],
        }
        hash_without = compute_document_content_hash("quote", base)
        hash_with = compute_document_content_hash("quote", {
            **base, "id": 99, "status": "sent", "created_at": "2026-01-01", "updated_at": "2026-04-01",
        })
        self.assertEqual(hash_without, hash_with)

    def test_quote_hash_changes_on_content_change(self):
        data1 = {"title": "A", "version": 1, "tax_percent": "0", "terms_text": "", "line_items": []}
        data2 = {"title": "B", "version": 1, "tax_percent": "0", "terms_text": "", "line_items": []}
        self.assertNotEqual(
            compute_document_content_hash("quote", data1),
            compute_document_content_hash("quote", data2),
        )

    def test_change_order_hash(self):
        data = {
            "family_key": "CO-001",
            "reason": "Added scope",
            "amount_delta": "5000.00",
            "terms_text": "",
            "line_items": [
                {"description": "Extra framing", "amount_delta": "5000.00",
                 "days_delta": 3, "cost_code": None, "adjustment_reason": "scope add"},
            ],
        }
        h = compute_document_content_hash("change_order", data)
        self.assertEqual(len(h), 64)

    def test_invoice_hash(self):
        data = {
            "invoice_number": "INV-001",
            "total": "1000.00",
            "balance_due": "1000.00",
            "tax_percent": "0",
            "terms_text": "Due on receipt",
            "line_items": [
                {"description": "Labor", "quantity": 8, "unit_price": "125.00",
                 "cost_code": None, "unit": "hr"},
            ],
        }
        h = compute_document_content_hash("invoice", data)
        self.assertEqual(len(h), 64)

    def test_unknown_document_type_raises(self):
        with self.assertRaises(ValueError) as ctx:
            compute_document_content_hash("receipt", {})
        self.assertIn("receipt", str(ctx.exception))

    def test_different_document_types_produce_different_hashes(self):
        """Even with overlapping field names, type-specific extraction differs."""
        shared = {"terms_text": "Net 30", "line_items": []}
        quote_data = {**shared, "title": "X", "version": 1, "tax_percent": "0"}
        invoice_data = {**shared, "invoice_number": "X", "total": "0", "balance_due": "0", "tax_percent": "0"}
        self.assertNotEqual(
            compute_document_content_hash("quote", quote_data),
            compute_document_content_hash("invoice", invoice_data),
        )


class MaskEmailTests(TestCase):
    def test_standard_email(self):
        self.assertEqual(mask_email("jane@example.com"), "j***@example.com")

    def test_single_char_local(self):
        self.assertEqual(mask_email("j@example.com"), "j***@example.com")

    def test_long_local(self):
        self.assertEqual(mask_email("longusername@example.com"), "l***@example.com")

    def test_empty_string(self):
        self.assertEqual(mask_email(""), "")

    def test_none(self):
        self.assertEqual(mask_email(None), "")

    def test_no_at_sign(self):
        self.assertEqual(mask_email("notanemail"), "notanemail")

    def test_multiple_at_signs(self):
        """Should split on the last @ sign."""
        self.assertEqual(mask_email("weird@name@example.com"), "w***@example.com")
