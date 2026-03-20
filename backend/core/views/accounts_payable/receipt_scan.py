"""Receipt image scanning — best-effort field extraction via Gemini Vision."""

import logging
import os

from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.user_helpers import _ensure_org_membership
from core.views.accounts_payable.receipt_scan_helpers import (
    ALLOWED_CONTENT_TYPES,
    EXTRACTION_PROMPT,
    MAX_IMAGE_BYTES,
    _parse_gemini_response,
)
from core.views.helpers import _capability_gate

logger = logging.getLogger(__name__)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser])
def receipt_scan_view(request):
    """Accept a receipt image and return best-effort extracted fields.

    Sends the image to Gemini Vision for OCR extraction. Does NOT create
    any records — only returns suggested values for the frontend to
    prefill the receipt form.

    Flow:
        1. Validate org membership and ``vendor_bills.create`` capability.
        2. Check that the Gemini API key is configured (503 if not).
        3. Validate the uploaded image (presence, content type, size).
        4. Send the image + extraction prompt to Gemini Vision.
        5. Parse the response (stripping markdown fences if present).
        6. Return extracted fields, with empty strings for anything unreadable.
           On Gemini failure, gracefully return all-empty fields.

    URL: ``POST /api/v1/receipts/scan/``

    Request body: multipart form data with an ``image`` file field.

    Success 200::

        { "data": { "store_name": "...", "amount": "...", "receipt_date": "..." } }

    Errors:
        - 400: No image provided, unsupported type, or exceeds 5 MB.
        - 403: No active membership or missing ``vendor_bills.create`` capability.
        - 503: Gemini API key not configured.
    """
    membership = _ensure_org_membership(request.user)
    if not membership:
        return Response({"error": {"code": "forbidden", "message": "No active membership."}}, status=403)

    permission_error, _ = _capability_gate(request.user, "vendor_bills", "create")
    if permission_error:
        return Response(permission_error, status=403)

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
