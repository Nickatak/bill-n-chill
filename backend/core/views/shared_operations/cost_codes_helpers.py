"""Domain-specific helpers for cost-code views."""

from django.db.models import Q
from rest_framework.response import Response

from core.models import CostCode
from core.views.helpers import _ensure_membership


def _cost_code_scope_filter(user):
    """Build a Q filter for cost codes visible to the given user's organization."""
    membership = _ensure_membership(user)
    return Q(organization_id=membership.organization_id)


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
