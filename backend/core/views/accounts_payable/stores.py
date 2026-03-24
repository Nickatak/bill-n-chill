"""Store list endpoint — org-scoped store names for autocomplete."""

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Store
from core.views.helpers import _ensure_org_membership


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def org_stores_view(request):
    """Return all stores for the authenticated user's org.

    Lightweight endpoint for autocomplete — returns id + name only.

    URL: ``GET /api/v1/stores/``

    Success 200::

        { "data": [ { "id": 1, "name": "Home Depot" }, ... ] }
    """
    membership = _ensure_org_membership(request.user)
    stores = Store.objects.filter(
        organization_id=membership.organization_id,
    ).order_by("name").values("id", "name")
    return Response({"data": list(stores)})
