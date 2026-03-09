"""Domain-specific helpers for cost-code views."""

from rest_framework.response import Response

from core.views.helpers import _cost_code_scope_filter  # noqa: F401 — re-exported for cost_codes.py


def _duplicate_code_error_response():
    """Return a 400 response for duplicate cost code code within an organization."""
    return Response(
        {
            "error": {
                "code": "validation_error",
                "message": "A cost code with this code already exists in your organization.",
                "fields": {"code": ["Code must be unique within your organization."]},
            }
        },
        status=400,
    )
