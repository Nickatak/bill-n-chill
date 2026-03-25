"""Quick expense endpoint — create a minimal VendorBill for retail/misc purchases."""

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Payment, Vendor, VendorBill
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
    """Create a quick expense (minimal VendorBill) for a project.

    Quick expenses are minimal bills for retail/misc purchases that don't
    need a full bill number or line items.  Line items can be added later
    (e.g. via OCR scan + PATCH).

    Flow:
        1. Validate the project belongs to the user's org.
        2. Gate on ``vendor_bills.create`` capability.
        2b. Reject if project is cancelled (terminal guard).
        3. Validate total (required, > 0).
        4. Create or find vendor by name (optional).
        5. Create a VendorBill with total/balance_due set directly.
        6. Return the serialized bill.

    URL: ``POST /api/v1/projects/<project_id>/expenses/``

    Request body::

        {
            "total": "decimal (required, > 0)",
            "vendor_name": "string (optional — auto-creates vendor if new)",
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

    # Accept both vendor_name (canonical) and store_name (legacy compat).
    vendor_name = (request.data.get("vendor_name") or request.data.get("store_name") or "").strip()
    vendor = None
    if vendor_name:
        vendor, _ = Vendor.get_or_create_by_name(
            project.organization_id, vendor_name, request.user,
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
            vendor=vendor,
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
