"""Quick expense endpoint — create a minimal VendorBill with no vendor."""

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Payment, Store, VendorBill
from core.serializers import VendorBillSerializer
from core.utils.money import MONEY_ZERO, quantize_money, validate_positive_amount
from django.db import transaction

from core.views.accounts_payable.vendor_bills_helpers import _prefetch_vendor_bill_qs
from core.views.helpers import (
    _capability_gate,
    _check_project_accepts_document,
    _ensure_org_membership,
    _promote_prospect_to_active,
    _validate_project_for_user,
)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def project_expenses_view(request, project_id: int):
    """Create a quick expense (VendorBill with no vendor) for a project.

    Quick expenses are minimal bills for retail/misc purchases that don't
    need a full vendor relationship, bill number, or line items.  Line
    items can be added later (e.g. via OCR scan + PATCH).

    Flow:
        1. Validate the project belongs to the user's org.
        2. Gate on ``vendor_bills.create`` capability.
        2b. Reject if project is cancelled (terminal guard).
        3. Validate total (required, > 0).
        4. Create a VendorBill with null vendor, set total/balance_due directly.
        5. Return the serialized bill.

    URL: ``POST /api/v1/projects/<project_id>/expenses/``

    Request body::

        {
            "total": "decimal (required, > 0)",
            "store_name": "string (optional)",
            "issue_date": "YYYY-MM-DD (optional, defaults to today)",
            "notes": "string (optional)"
        }

    Success 201::

        { "data": { ... } }

    Errors:
        - 400: Missing or invalid total.
        - 403: Missing ``vendor_bills.create`` capability.
        - 404: Project not found or not in user's org.
    """
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _capability_gate(request.user, "vendor_bills", "create")
    if permission_error:
        return Response(permission_error, status=403)

    terminal_error = _check_project_accepts_document(project, "expenses")
    if terminal_error:
        return terminal_error

    raw_total = request.data.get("total")
    if raw_total is None or raw_total == "":
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Total is required.",
                    "fields": {"total": ["This field is required."]},
                }
            },
            status=400,
        )

    try:
        total = quantize_money(raw_total)
    except Exception:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid total value.",
                    "fields": {"total": ["Enter a valid number."]},
                }
            },
            status=400,
        )

    if amount_error := validate_positive_amount(total):
        return Response(amount_error, status=400)

    store_name = (request.data.get("store_name") or "").strip()
    store = None
    if store_name:
        store, _ = Store.get_or_create_by_name(
            project.organization_id, store_name, request.user,
        )

    issue_date = request.data.get("issue_date") or timezone.localdate()
    notes = request.data.get("notes", "")
    method = request.data.get("method", Payment.Method.CARD)
    if method not in {v for v, _ in Payment.Method.choices}:
        method = Payment.Method.CARD

    membership = _ensure_org_membership(request.user)

    with transaction.atomic():
        vendor_bill = VendorBill.objects.create(
            project=project,
            vendor=None,
            store=store,
            bill_number="",
            status=VendorBill.Status.OPEN,
            issue_date=issue_date,
            total=total,
            balance_due=MONEY_ZERO,
            notes=notes,
            created_by=request.user,
        )

        Payment.objects.create(
            organization_id=membership.organization_id,
            project=project,
            direction=Payment.Direction.OUTBOUND,
            method=method,
            status=Payment.Status.SETTLED,
            amount=total,
            payment_date=timezone.localdate(),
            target_type=Payment.TargetType.VENDOR_BILL,
            vendor_bill=vendor_bill,
            created_by=request.user,
        )

        _promote_prospect_to_active(project)

    return Response(
        {
            "data": VendorBillSerializer(
                _prefetch_vendor_bill_qs(VendorBill.objects.filter(id=vendor_bill.id)).get()
            ).data,
        },
        status=201,
    )
