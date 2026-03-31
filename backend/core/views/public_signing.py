"""Public document signing — OTP request and verification views.

The ``document_type`` URL segment must be one of ``quote``, ``change_order``,
or ``invoice``.  Reusable ceremony validation and consent helpers live in
``public_signing_helpers``.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from core.models import DocumentAccessSession
from core.models.shared_operations.document_access_session import SESSION_EXPIRY_MINUTES
from django_q.tasks import async_task
from core.utils.signing import mask_email
from core.views.public_signing_helpers import (
    _DOCUMENT_TYPE_LABELS,
    _VERIFY_ERROR_MAP,
    _resolve_document_and_email,
    _resolve_document_title,
)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_request_otp_view(request, document_type, public_token):
    """Request a 6-digit OTP code for public document identity verification.

    Resolves the document via ``document_type`` + ``public_token``, extracts the
    customer email from the linked project, and sends a one-time code via Mailgun.

    Flow:
        1. Resolve the document and customer email via ``_resolve_document_and_email``.
        2. Reject if the customer has no email (422).
        3. Rate-limit: reject if an OTP was created for this ``public_token`` within
           the last 60 seconds (429).
        4. Create a new ``DocumentAccessSession`` (auto-generates a 6-digit code
           and a session token on save).
        5. Send the OTP code to the customer email via Mailgun.
        6. Return a masked email hint and 600-second (10 min) code expiry.

    URL: ``POST /api/v1/public/<document_type>/<public_token>/otp/``

    Request body: (none)

    Success 200::

        { "data": { "otp_required": true, "email_hint": "j***@example.com", "expires_in": 600 } }

    Errors:
        - 400: Invalid ``document_type`` (not in ``quote``, ``change_order``, ``invoice``).
        - 404: No document found for the given ``public_token``.
        - 422: Customer on the project has no email address on file.
        - 429: OTP already requested within the last 60 seconds for this token.
    """
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
    latest_session = (
        DocumentAccessSession.objects
        .filter(public_token=public_token)
        .order_by("-created_at")
        .first()
    )
    if latest_session and (timezone.now() - latest_session.created_at) < timedelta(seconds=60):
        wait = 60 - int((timezone.now() - latest_session.created_at).total_seconds())
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
    async_task(
        "core.tasks.send_otp_email_task",
        customer_email,
        session.code,
        _DOCUMENT_TYPE_LABELS.get(document_type, "Document"),
        document_title,
    )

    return Response(
        {"data": {
            "otp_required": True,
            "email_hint": mask_email(customer_email),
            "expires_in": 600,
        }},
        status=200,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def public_verify_otp_view(request, document_type, public_token):
    """Verify a 6-digit OTP code and activate a 1-hour signing session.

    On success, marks the ``DocumentAccessSession`` as verified and returns a
    ``session_token`` that the customer must include when submitting a decision
    on the corresponding ``/decision/`` endpoint.

    Flow:
        1. Extract and validate the ``code`` field from the request body.
        2. Look up the matching ``DocumentAccessSession`` via
           ``lookup_for_verification(public_token, code)``.  This classmethod
           checks expiry, prior verification, and failed-attempt limits.
        3. On success, activate the session: set ``verified_at`` to now and
           ``session_expires_at`` to now + ``SESSION_EXPIRY_MINUTES`` (60 min).
        4. Return the ``session_token`` the customer will include in their
           subsequent ``/decision/`` request.

    URL: ``POST /api/v1/public/<document_type>/<public_token>/otp/verify/``

    Request body::

        { "code": "123456" }

    Success 200::

        { "data": { "session_token": "<uuid>", "expires_in": 3600 } }

    Errors:
        - 400: Missing or empty ``code``.
        - 404: No matching unverified session for this token + code.
        - 409: Code has already been verified (session already activated).
        - 410: Code has expired (>10 minutes since OTP was requested).
        - 429: Too many failed verification attempts — customer must request a new OTP.
    """
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
    session.session_expires_at = timezone.now() + timedelta(minutes=SESSION_EXPIRY_MINUTES)
    session.save(update_fields=["verified_at", "session_expires_at"])

    return Response(
        {"data": {
            "session_token": session.session_token,
            "expires_in": 3600,
        }},
        status=200,
    )
