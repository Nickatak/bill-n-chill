"""Public document signing — OTP verification endpoint wrappers.

Thin per-document-type view wrappers that delegate to shared helpers
in ``public_signing_helpers``.
"""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from core.views.public_signing_helpers import _request_otp_handler, _verify_otp_handler


# ---------------------------------------------------------------------------
# Estimates
# ---------------------------------------------------------------------------


@api_view(["POST"])
@permission_classes([AllowAny])
def public_estimate_request_otp_view(request, public_token: str):
    """Request an OTP code for estimate public link verification."""
    return _request_otp_handler(request, "estimate", public_token)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_estimate_verify_otp_view(request, public_token: str):
    """Verify an OTP code for estimate public link."""
    return _verify_otp_handler(request, "estimate", public_token)


# ---------------------------------------------------------------------------
# Change Orders
# ---------------------------------------------------------------------------


@api_view(["POST"])
@permission_classes([AllowAny])
def public_change_order_request_otp_view(request, public_token: str):
    """Request an OTP code for change order public link verification."""
    return _request_otp_handler(request, "change_order", public_token)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_change_order_verify_otp_view(request, public_token: str):
    """Verify an OTP code for change order public link."""
    return _verify_otp_handler(request, "change_order", public_token)


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------


@api_view(["POST"])
@permission_classes([AllowAny])
def public_invoice_request_otp_view(request, public_token: str):
    """Request an OTP code for invoice public link verification."""
    return _request_otp_handler(request, "invoice", public_token)


@api_view(["POST"])
@permission_classes([AllowAny])
def public_invoice_verify_otp_view(request, public_token: str):
    """Verify an OTP code for invoice public link."""
    return _verify_otp_handler(request, "invoice", public_token)
