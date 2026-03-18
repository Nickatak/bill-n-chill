"""Receipt image scanning — best-effort field extraction via Gemini Vision."""

import json
import logging
import os

from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

logger = logging.getLogger(__name__)

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
    """Extract JSON from Gemini response, handling markdown code fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Strip ```json ... ``` wrapping
        lines = cleaned.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        cleaned = "\n".join(lines).strip()
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        return {}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def receipt_scan_view(request):
    """Accept a receipt image and return best-effort extracted fields.

    This endpoint does NOT create any records — it only returns suggested
    field values for the frontend to prefill the receipt form.

    Expects multipart form data with an ``image`` file field.
    Returns ``{"data": {"store_name": "...", "amount": "...", "receipt_date": "..."}}``
    with empty strings for any fields that could not be extracted.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return Response(
            {"error": {"code": "service_unavailable", "message": "Receipt scanning is not configured."}},
            status=503,
        )

    image_file = request.FILES.get("image")
    if not image_file:
        return Response(
            {"error": {"code": "validation_error", "message": "No image provided.", "fields": {"image": ["Required."]}}},
            status=400,
        )

    content_type = (image_file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        return Response(
            {"error": {"code": "validation_error", "message": f"Unsupported image type: {content_type}", "fields": {"image": ["Use JPEG, PNG, WebP, or HEIC."]}}},
            status=400,
        )

    if image_file.size > MAX_IMAGE_BYTES:
        return Response(
            {"error": {"code": "validation_error", "message": "Image too large (max 5 MB).", "fields": {"image": ["Max 5 MB."]}}},
            status=400,
        )

    image_bytes = image_file.read()

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        response = model.generate_content(
            [
                EXTRACTION_PROMPT,
                {"mime_type": content_type, "data": image_bytes},
            ],
        )

        extracted = _parse_gemini_response(response.text or "")
    except Exception:
        logger.exception("Gemini receipt scan failed")
        return Response(
            {"data": {"store_name": "", "amount": "", "receipt_date": ""}},
        )

    return Response({
        "data": {
            "store_name": str(extracted.get("store_name", "") or "").strip(),
            "amount": str(extracted.get("amount", "") or "").strip(),
            "receipt_date": str(extracted.get("receipt_date", "") or "").strip(),
        }
    })
