"""Domain-specific helpers for cost-code views."""

from rest_framework.response import Response

from core.views.helpers import _org_scope_filter  # noqa: F401 — re-exported for cost_codes.py


def _duplicate_code_error_response() -> Response:
    """Return a 400 response for a duplicate cost code within an organization.

    Used by both the pre-check path and the ``IntegrityError`` fallback in
    ``cost_codes_list_create_view`` to return a consistent error shape.
    """
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
