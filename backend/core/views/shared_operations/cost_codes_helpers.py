"""Domain-specific helpers for cost-code views."""

from django.db.models import Q
from rest_framework.response import Response

from core.models import CostCode
from core.views.helpers import _ensure_membership, _organization_user_ids


def _cost_code_scope_filter(user):
    membership = _ensure_membership(user)
    actor_user_ids = _organization_user_ids(user)
    return Q(organization_id=membership.organization_id) | Q(
        organization__isnull=True,
        created_by_id__in=actor_user_ids,
    )


def _duplicate_code_error_response():
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
