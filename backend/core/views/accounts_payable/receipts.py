"""Receipt endpoints — project-scoped expense records."""

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Receipt, Store
from core.serializers import ReceiptSerializer, ReceiptWriteSerializer
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    _capability_gate,
    _validate_project_for_user,
)
from core.user_helpers import _ensure_membership


def _prefetch_receipt_qs(qs):
    """Apply standard select/prefetch for receipt queries."""
    return qs.select_related("project", "store").prefetch_related(
        "payment_allocations", "payment_allocations__payment",
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def org_receipts_view(request):
    """Org-level receipt list — all receipts across all projects for the accounting page."""
    membership = _ensure_membership(request.user)
    rows = _prefetch_receipt_qs(
        Receipt.objects.filter(project__organization_id=membership.organization_id)
        .order_by("-receipt_date", "-created_at")
    )
    return Response({"data": ReceiptSerializer(rows, many=True).data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_receipts_view(request, project_id: int):
    """Project receipt collection: list or create receipts.

    Contract:
    - ``GET``: returns all receipts for the project.
    - ``POST`` (requires ``owner|pm|bookkeeping``): creates a receipt record.
      If ``store_name`` is provided, finds or creates an org-scoped Store record.

    Incoming payload (``POST``):
      {
        "store_name": "string (optional — finds or creates Store)",
        "amount": "decimal (required, > 0)",
        "receipt_date": "YYYY-MM-DD (optional, defaults to today)",
        "notes": "string (optional)"
      }
    """
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = _prefetch_receipt_qs(
            Receipt.objects.filter(project=project).order_by("-receipt_date", "-created_at")
        )
        return Response({"data": ReceiptSerializer(rows, many=True).data})

    permission_error, _ = _capability_gate(request.user, "vendor_bills", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = ReceiptWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    amount = quantize_money(data["amount"])
    if amount <= MONEY_ZERO:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Amount must be greater than zero.",
                    "fields": {"amount": ["Must be greater than zero."]},
                }
            },
            status=400,
        )

    # Find-or-create Store by name (org-scoped, case-insensitive)
    store = None
    store_name = (data.get("store_name") or "").strip()
    if store_name:
        membership = _ensure_membership(request.user)
        store, _ = Store.objects.get_or_create(
            organization_id=membership.organization_id,
            name__iexact=store_name,
            defaults={
                "name": store_name,
                "organization_id": membership.organization_id,
                "created_by": request.user,
            },
        )

    receipt_date = data.get("receipt_date") or timezone.localdate()

    receipt = Receipt.objects.create(
        project=project,
        store=store,
        amount=amount,
        balance_due=amount,
        receipt_date=receipt_date,
        notes=data.get("notes", ""),
        created_by=request.user,
    )

    return Response(
        {"data": ReceiptSerializer(_prefetch_receipt_qs(Receipt.objects.filter(id=receipt.id)).get()).data},
        status=201,
    )
