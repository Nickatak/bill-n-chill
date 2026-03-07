"""Domain-specific helpers for public document signing views.

Shared OTP lifecycle, document resolution, and ceremony validation logic
used by both the OTP endpoints and the per-document-type decision views.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    DocumentAccessSession,
    Estimate,
    Invoice,
)
from core.utils.email import send_otp_email
from core.utils.signing import (
    CEREMONY_CONSENT_TEXT,
    CEREMONY_CONSENT_TEXT_VERSION,
    mask_email,
)


# ---------------------------------------------------------------------------
# Document type labels (for email body context)
# ---------------------------------------------------------------------------

_DOCUMENT_TYPE_LABELS = {
    "estimate": "Estimate",
    "change_order": "Change Order",
    "invoice": "Invoice",
}

# ---------------------------------------------------------------------------
# Document resolution
# ---------------------------------------------------------------------------

_DOCUMENT_MODELS = {
    "estimate": Estimate,
    "change_order": ChangeOrder,
    "invoice": Invoice,
}


def _resolve_document_and_email(document_type, public_token):
    """Look up a document by type + public_token and extract the customer email.

    Returns (document, customer_email_or_empty, error_response_or_none).
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
    """Extract a human-readable title from a document for email context."""
    if document_type == "estimate":
        return document.title or f"Estimate #{document.id}"
    elif document_type == "change_order":
        return f"CO-{document.family_key}-v{document.revision_number}"
    elif document_type == "invoice":
        return document.invoice_number or f"Invoice #{document.id}"
    return f"Document #{document.id}"


# ---------------------------------------------------------------------------
# OTP request handler
# ---------------------------------------------------------------------------

def _request_otp_handler(request, document_type, public_token):
    """Handle a request to send an OTP code for public document verification."""
    document, customer_email, error = _resolve_document_and_email(document_type, public_token)
    if error:
        return error

    if not customer_email:
        return Response(
            {"error": {
                "code": "customer_email_required",
                "message": "A customer email address is required for identity verification. Please ask your contractor to update your contact information.",
            }},
            status=422,
        )

    # Rate limit: most recent session for this public_token created <60s ago.
    latest = (
        DocumentAccessSession.objects
        .filter(public_token=public_token)
        .order_by("-created_at")
        .first()
    )
    if latest and (timezone.now() - latest.created_at) < timedelta(seconds=60):
        wait = 60 - int((timezone.now() - latest.created_at).total_seconds())
        return Response(
            {"error": {"code": "rate_limited", "message": f"Please wait {wait} seconds before requesting another code."}},
            status=429,
        )

    session = DocumentAccessSession(
        document_type=document_type,
        document_id=document.id,
        public_token=public_token,
        recipient_email=customer_email,
    )
    session.save()

    document_title = _resolve_document_title(document_type, document)
    # TODO: send_otp_email blocks the request — move to async task (Celery/background)
    # so Mailgun latency/failures don't hang the customer's browser.
    send_otp_email(
        recipient_email=customer_email,
        code=session.code,
        document_type_label=_DOCUMENT_TYPE_LABELS.get(document_type, "Document"),
        document_title=document_title,
    )

    return Response(
        {"data": {
            "otp_required": True,
            "email_hint": mask_email(customer_email),
            "expires_in": 600,
        }},
        status=200,
    )


# ---------------------------------------------------------------------------
# OTP verification handler
# ---------------------------------------------------------------------------

_VERIFY_ERROR_MAP = {
    "not_found": (404, "not_found", "Invalid verification code."),
    "expired": (410, "expired", "This verification code has expired. Request a new one."),
    "already_verified": (409, "already_verified", "This code has already been verified."),
    "max_attempts": (429, "max_attempts", "Too many failed attempts. Request a new code."),
}


def _verify_otp_handler(request, document_type, public_token):
    """Handle OTP code verification for a public document session."""
    code = (request.data.get("code") or "").strip()
    if not code:
        return Response(
            {"error": {"code": "validation_error", "message": "code is required."}},
            status=400,
        )

    session, error_code = DocumentAccessSession.lookup_for_verification(public_token, code)
    if error_code:
        status, code_val, message = _VERIFY_ERROR_MAP[error_code]
        return Response({"error": {"code": code_val, "message": message}}, status=status)

    # Activate the session.
    session.verified_at = timezone.now()
    from core.models.shared_operations.document_access_session import SESSION_EXPIRY_MINUTES
    session.session_expires_at = timezone.now() + timedelta(minutes=SESSION_EXPIRY_MINUTES)
    session.save(update_fields=["verified_at", "session_expires_at"])

    return Response(
        {"data": {
            "session_token": session.session_token,
            "expires_in": 3600,
        }},
        status=200,
    )


# ---------------------------------------------------------------------------
# Ceremony validation (called from existing decision views)
# ---------------------------------------------------------------------------

def validate_ceremony_on_decision(request, public_token, customer_email):
    """Validate OTP session and ceremony data before allowing a public decision.

    Returns (session, signer_name, error_response_or_none).
    Called from each public_*_decision_view before executing decision logic.
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
    """Return the current consent text and version for use by decision views."""
    return CEREMONY_CONSENT_TEXT, CEREMONY_CONSENT_TEXT_VERSION
