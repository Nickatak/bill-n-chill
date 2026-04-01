"""Helpers for bill/receipt scanning — Gemini integration, validation constants, response parsing."""

import json

# Maximum image size: 5 MB (Gemini accepts up to 20 MB, but no need for huge files).
MAX_IMAGE_BYTES = 5 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}

EXTRACTION_PROMPT = """Look at this image of a financial document (could be a store receipt,
a vendor invoice, or a bill) and extract as much information as you can.

Return ONLY a JSON object with these keys — no markdown, no explanation:

{
  "document_type": "receipt" or "bill" — use "receipt" for retail store receipts, "bill" for vendor invoices/bills,
  "vendor_name": "the business, store, or company name on the document — whoever was paid, or empty string if unreadable",
  "bill_number": "any document identifier — invoice number, receipt number, transaction number, order number, confirmation number — or empty string if not found",
  "issue_date": "the document date or invoice date in YYYY-MM-DD format, or empty string if unreadable",
  "due_date": "the due date or payment due date in YYYY-MM-DD format, or empty string if not found",
  "subtotal": "the subtotal before tax as a decimal string like '130.00', or empty string if not found",
  "tax_total": "the tax amount as a decimal string like '12.87', or empty string if not found",
  "shipping_total": "shipping or freight charges as a decimal string, or empty string if not found",
  "total": "the total amount as a decimal string like '142.87', or empty string if unreadable",
  "line_items": [
    {
      "description": "item description",
      "quantity": "quantity as a decimal string like '1' or '2.5', default '1' if not shown",
      "unit_price": "unit price as a decimal string like '32.50'"
    }
  ]
}

Rules:
- If you cannot read a field, use an empty string for that field.
- For line_items, extract as many individual items as you can see. If none are readable, use an empty array [].
- Do not guess values — only extract what is clearly visible on the document.
- Quantities default to "1" when not explicitly shown on the document.
- All monetary values should be decimal strings without currency symbols."""


def _parse_gemini_response(text: str) -> dict:
    """Extract JSON from a Gemini text response.

    Gemini sometimes wraps its JSON output in markdown code fences
    (e.g. ```json ... ```). This strips those fences before parsing
    so callers always get a plain dict back — or an empty dict if
    the response is unparseable.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        text_lines = cleaned.split("\n")
        text_lines = [line for line in text_lines if not line.strip().startswith("```")]
        cleaned = "\n".join(text_lines).strip()
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return {}


# Keys that should always be present in the response with string defaults.
_STRING_FIELDS = (
    "document_type", "vendor_name", "bill_number",
    "issue_date", "due_date", "subtotal", "tax_total",
    "shipping_total", "total",
)


def normalize_scan_result(raw: dict) -> dict:
    """Ensure the scan result has all expected keys with safe defaults.

    Fills missing string fields with "" and missing line_items with [].
    Sanitises each line item to only include expected keys.
    """
    result = {}
    for key in _STRING_FIELDS:
        result[key] = str(raw.get(key, "") or "").strip()

    raw_lines = raw.get("line_items") or []
    result["line_items"] = [
        {
            "description": str(item.get("description", "") or "").strip(),
            "quantity": str(item.get("quantity", "1") or "1").strip(),
            "unit_price": str(item.get("unit_price", "") or "").strip(),
        }
        for item in raw_lines
        if isinstance(item, dict)
    ]

    return result
