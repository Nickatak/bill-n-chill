"""Shared helpers for public document signing views.

Contains:
    - Document type registry and resolution (used by OTP views in ``public_signing``).
    - OTP verification error mapping (used by ``public_verify_otp_view``).
    - Ceremony validation and consent context (used by per-document decision views).
"""

from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    DocumentAccessSession,
    Estimate,
    Invoice,
)
from core.utils.signing import (
    CEREMONY_CONSENT_TEXT,
    CEREMONY_CONSENT_TEXT_VERSION,
)


# ---------------------------------------------------------------------------
# Document type registry
# ---------------------------------------------------------------------------

_DOCUMENT_MODELS = {
    "estimate": Estimate,
    "change_order": ChangeOrder,
    "invoice": Invoice,
}

_DOCUMENT_TYPE_LABELS = {
    "estimate": "Estimate",
    "change_order": "Change Order",
    "invoice": "Invoice",
}


# ---------------------------------------------------------------------------
# Document resolution
# ---------------------------------------------------------------------------

def _resolve_document_and_email(document_type, public_token):
    """Look up a document by type + public_token and extract the customer email.

    Uses ``_DOCUMENT_MODELS`` to map ``document_type`` to the correct model class,
    then fetches the document with ``select_related("project__customer")`` to avoid
    extra queries when reading the customer email.

    Returns:
        (document, customer_email, None) on success — ``customer_email`` may be
        empty if the customer record has no email on file.

        (None, "", Response) on failure — the Response is ready to return from the
        calling view (400 for invalid type, 404 for missing document).
    """
    model = _DOCUMENT_MODELS.get(document_type)
    if not model:
        return None, "", Response(
            {"error": {"code": "invalid_document_type", "message": "Invalid document type."}},
            status=400,
        )
    try:
        document = model.objects.select_related("project__customer").get(public_token=public_token)
    except model.DoesNotExist:
        return None, "", Response(
            {"error": {"code": "not_found", "message": "Document not found."}},
            status=404,
        )

    customer_email = (document.project.customer.email or "").strip()
    return document, customer_email, None


def _resolve_document_title(document_type, document):
    """Extract a human-readable title from a document for OTP email context.

    Used in the OTP email body so the customer knows which document the code
    is for.  Falls back to ``Document #<id>`` for unknown types.

    Examples: ``"Kitchen Remodel"``, ``"CO-3-v2"``, ``"INV-001"``.
    """
    if document_type == "estimate":
        return document.title or f"Estimate #{document.id}"
    elif document_type == "change_order":
        return f"CO-{document.family_key}-v{document.revision_number}"
    elif document_type == "invoice":
        return document.invoice_number or f"Invoice #{document.id}"
    return f"Document #{document.id}"


# ---------------------------------------------------------------------------
# OTP verification error mapping
# ---------------------------------------------------------------------------

_VERIFY_ERROR_MAP = {
    "not_found": (404, "not_found", "Invalid verification code."),
    "expired": (410, "expired", "This verification code has expired. Request a new one."),
    "already_verified": (409, "already_verified", "This code has already been verified."),
    "max_attempts": (429, "max_attempts", "Too many failed attempts. Request a new code."),
}


# ---------------------------------------------------------------------------
# Ceremony validation (called from per-document decision views)
# ---------------------------------------------------------------------------

def validate_ceremony_on_decision(request, public_token, customer_email):
    """Gate-check called by each ``public_*_decision_view`` before executing
    decision logic.

    Validates, in order:
        1. **Customer email exists** — the project must have a customer with an
           email on file (422 if missing).
        2. **Session token present** — the request body must include
           ``session_token`` (403 if missing).
        3. **Session valid** — the token must resolve to a verified, non-expired
           ``DocumentAccessSession`` via ``lookup_valid_session`` (403 if invalid
           or expired).
        4. **Signer name** — ``signer_name`` must be a non-empty string (400).
        5. **Consent accepted** — ``consent_accepted`` must be exactly ``True``
           (400).  This maps to the customer checking the consent checkbox in
           the signing ceremony UI.

    Returns:
        (session, signer_name, None) on success — the caller uses ``session``
        to link the ``SigningCeremonyRecord`` and ``signer_name`` for the audit
        trail.

        (None, "", Response) on failure — the Response is ready to return.
    """
    if not customer_email:
        return None, "", Response(
            {"error": {
                "code": "customer_email_required",
                "message": "A customer email address is required for identity verification.",
            }},
            status=422,
        )

    # Validate session token.
    session_token = (request.data.get("session_token") or "").strip()
    if not session_token:
        return None, "", Response(
            {"error": {"code": "session_required", "message": "Identity verification is required before submitting a decision."}},
            status=403,
        )

    session, error_code = DocumentAccessSession.lookup_valid_session(public_token, session_token)
    if error_code:
        error_map = {
            "not_found": (403, "session_invalid", "Invalid session. Please verify your identity again."),
            "expired": (403, "session_expired", "Your session has expired. Please verify your identity again."),
        }
        status, code, message = error_map.get(error_code, (403, "session_invalid", "Invalid session."))
        return None, "", Response({"error": {"code": code, "message": message}}, status=status)

    # Validate ceremony fields.
    signer_name = (request.data.get("signer_name") or "").strip()
    if not signer_name:
        return None, "", Response(
            {"error": {"code": "validation_error", "message": "signer_name is required."}},
            status=400,
        )

    consent_accepted = request.data.get("consent_accepted")
    if consent_accepted is not True:
        return None, "", Response(
            {"error": {"code": "validation_error", "message": "consent_accepted must be true."}},
            status=400,
        )

    return session, signer_name, None


def get_ceremony_context():
    """Return the current consent text and its SHA-256 version hash.

    Called by each decision view to snapshot the consent language into the
    ``SigningCeremonyRecord``.  If the consent text changes, the version hash
    changes with it, so historical records reflect exactly what the customer
    agreed to at signing time.
    """
    return CEREMONY_CONSENT_TEXT, CEREMONY_CONSENT_TEXT_VERSION
