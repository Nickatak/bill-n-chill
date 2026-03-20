"""Helpers for receipt scanning — Gemini integration, validation constants, response parsing."""

import json

# Maximum image size: 5 MB (Gemini accepts up to 20 MB, but no need for huge files).
MAX_IMAGE_BYTES = 5 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}

EXTRACTION_PROMPT = """Look at this receipt image and extract the following fields.
Return ONLY a JSON object with these keys — no markdown, no explanation:

{
  "store_name": "the store or business name, or empty string if unreadable",
  "amount": "the total amount as a decimal string like '47.82', or empty string if unreadable",
  "receipt_date": "the date in YYYY-MM-DD format, or empty string if unreadable"
}

If you cannot read a field, use an empty string for that field. Do not guess."""


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
