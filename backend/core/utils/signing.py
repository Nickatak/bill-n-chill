"""Signing ceremony utilities — content hashing, consent text, email masking."""

import hashlib
import json


# ---------------------------------------------------------------------------
# Consent language
# ---------------------------------------------------------------------------

CEREMONY_CONSENT_TEXT = (
    "By typing my name and checking this box, I confirm that:\n"
    "1. I have reviewed the document above in its entirety.\n"
    "2. I intend this action to serve as my electronic signature.\n"
    "3. I understand this constitutes a legally binding agreement under\n"
    "   applicable electronic signature laws (ESIGN Act / UETA).\n"
    "4. I consent to conducting this transaction electronically."
)


def compute_consent_text_version(text: str) -> str:
    """Return SHA-256 hex digest of the consent text for version tracking."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# Pre-computed for the current consent text.
CEREMONY_CONSENT_TEXT_VERSION = compute_consent_text_version(CEREMONY_CONSENT_TEXT)


# ---------------------------------------------------------------------------
# Document content hashing
# ---------------------------------------------------------------------------

# Per-document-type field extraction for deterministic hashing.
# Only content-relevant fields are included — volatile fields (status,
# updated_at, created_at, id) are excluded so the hash represents
# the document content the signer reviewed.

_QUOTE_LINE_FIELDS = ("description", "quantity", "unit_price", "markup_percent", "cost_code", "unit")
_CHANGE_ORDER_LINE_FIELDS = ("description", "amount_delta", "days_delta", "cost_code", "adjustment_reason")
_INVOICE_LINE_FIELDS = ("description", "quantity", "unit_price", "cost_code", "unit")


def _extract_line_items(serialized_data: dict, fields: tuple[str, ...]) -> list[dict]:
    """Extract content-relevant fields from serialized line items."""
    raw_lines = serialized_data.get("line_items") or []
    extracted = []
    for line in raw_lines:
        extracted.append({field: line.get(field) for field in fields})
    return extracted


def compute_document_content_hash(document_type: str, serialized_data: dict) -> str:
    """Compute SHA-256 of the content-relevant fields of a serialized document.

    Excludes volatile fields (status, timestamps, IDs) so the hash represents
    exactly what the customer reviewed. Field sets are per-document-type.
    """
    if document_type == "quote":
        content = {
            "title": serialized_data.get("title"),
            "version": serialized_data.get("version"),
            "tax_percent": serialized_data.get("tax_percent"),
            "terms_text": serialized_data.get("terms_text"),
            "line_items": _extract_line_items(serialized_data, _QUOTE_LINE_FIELDS),
        }
    elif document_type == "change_order":
        content = {
            "family_key": serialized_data.get("family_key"),
            "reason": serialized_data.get("reason"),
            "amount_delta": serialized_data.get("amount_delta"),
            "terms_text": serialized_data.get("terms_text"),
            "line_items": _extract_line_items(serialized_data, _CHANGE_ORDER_LINE_FIELDS),
        }
    elif document_type == "invoice":
        content = {
            "invoice_number": serialized_data.get("invoice_number"),
            "total": serialized_data.get("total"),
            "balance_due": serialized_data.get("balance_due"),
            "tax_percent": serialized_data.get("tax_percent"),
            "terms_text": serialized_data.get("terms_text"),
            "line_items": _extract_line_items(serialized_data, _INVOICE_LINE_FIELDS),
        }
    else:
        raise ValueError(f"Unknown document_type: {document_type}")

    canonical = json.dumps(content, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Email masking
# ---------------------------------------------------------------------------


def mask_email(email: str) -> str:
    """Mask an email address for display: ``j***@example.com``."""
    if not email or "@" not in email:
        return email or ""
    local, domain = email.rsplit("@", 1)
    if len(local) <= 1:
        masked_local = local[0] + "***" if local else "***"
    else:
        masked_local = local[0] + "***"
    return f"{masked_local}@{domain}"
