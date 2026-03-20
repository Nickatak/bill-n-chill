"""Cash-management payment endpoints."""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Customer,
    Invoice,
    Payment,
    PaymentRecord,
    Receipt,
    VendorBill,
)
from core.policies import get_payment_policy_contract
from core.serializers import (
    PaymentSerializer,
    PaymentWriteSerializer,
)
from core.views.helpers import (
    _capability_gate,
    _ensure_org_membership,
    _validate_project_for_user,
)
from core.views.cash_management.payments_helpers import (
    _direction_target_mismatch,
    _recalculate_payment_target,
    _set_invoice_balance_from_payments,
    _set_receipt_balance_from_payments,
    _set_vendor_bill_balance_from_payments,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def payment_contract_view(_request):
    """Return canonical payment workflow policy for frontend UX guards."""
    return Response({"data": get_payment_policy_contract()})


def _resolve_and_link_target(data, payment_kwargs, membership, fields):
    """Resolve target_type + target_id from payload, populate payment FK kwargs.

    Returns the resolved target object or None.  Validation errors are
    appended to ``fields`` dict.
    """
    target_type = data.get("target_type", "")
    target_id = data.get("target_id")
    direction = payment_kwargs.get("direction", "")

    if not target_type or not target_id:
        # Target is optional at creation (unlinked payment)
        return None

    if _direction_target_mismatch(direction, target_type):
        fields["target_type"] = ["target_type does not match payment direction."]
        return None

    payment_kwargs["target_type"] = target_type

    if target_type == Payment.TargetType.INVOICE:
        target = Invoice.objects.filter(
            id=target_id,
            project__organization_id=membership.organization_id,
        ).first()
        if not target:
            fields["target_id"] = ["Invoice not found in this organization."]
            return None
        if target.status == Invoice.Status.VOID:
            fields["target_id"] = ["Cannot link payment to a void invoice."]
            return None
        if target.status == Invoice.Status.DRAFT:
            fields["target_id"] = ["Cannot record payment against a draft invoice. Send it first."]
            return None
        payment_kwargs["invoice"] = target
        return target

    if target_type == Payment.TargetType.VENDOR_BILL:
        target = VendorBill.objects.filter(
            id=target_id,
            project__organization_id=membership.organization_id,
        ).first()
        if not target:
            fields["target_id"] = ["Vendor bill not found in this organization."]
            return None
        if target.status == VendorBill.Status.VOID:
            fields["target_id"] = ["Cannot link payment to a void vendor bill."]
            return None
        payment_kwargs["vendor_bill"] = target
        return target

    if target_type == Payment.TargetType.RECEIPT:
        target = Receipt.objects.filter(
            id=target_id,
            project__organization_id=membership.organization_id,
        ).first()
        if not target:
            fields["target_id"] = ["Receipt not found in this organization."]
            return None
        payment_kwargs["receipt"] = target
        return target

    fields["target_type"] = ["Invalid target type."]
    return None


def _recalculate_target_balance(target, target_type, changed_by):
    """Recalculate the balance on a resolved target after payment creation."""
    if target_type == Payment.TargetType.INVOICE:
        _set_invoice_balance_from_payments(target, changed_by=changed_by)
    elif target_type == Payment.TargetType.VENDOR_BILL:
        _set_vendor_bill_balance_from_payments(target)
    elif target_type == Payment.TargetType.RECEIPT:
        _set_receipt_balance_from_payments(target)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def org_payments_view(request):
    """Org-level payment endpoint: GET lists all payments, POST creates a payment.

    POST accepts optional target_type + target_id to link directly to a document.
    """
    membership = _ensure_org_membership(request.user)

    if request.method == "GET":
        rows = (
            Payment.objects.filter(organization_id=membership.organization_id)
            .select_related("customer", "project", "invoice", "vendor_bill", "receipt")
            .order_by("-payment_date", "-created_at")
        )
        return Response({"data": PaymentSerializer(rows, many=True).data})

    permission_error, _ = _capability_gate(request.user, "payments", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = PaymentWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    fields = {}
    if "direction" not in data:
        fields["direction"] = ["This field is required."]
    if "method" not in data:
        fields["method"] = ["This field is required."]
    if "amount" not in data:
        fields["amount"] = ["This field is required."]
    if fields:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing required fields.", "fields": fields}},
            status=400,
        )

    # Resolve customer
    customer = None
    customer_id = data.get("customer")
    direction = data["direction"]
    if customer_id:
        customer = Customer.objects.filter(
            id=customer_id, organization_id=membership.organization_id,
        ).first()
        if not customer:
            return Response(
                {"error": {"code": "not_found", "message": "Customer not found.", "fields": {}}},
                status=404,
            )
    elif direction == Payment.Direction.INBOUND:
        return Response(
            {"error": {"code": "validation_error", "message": "Customer is required for inbound payments.", "fields": {"customer": ["This field is required for inbound payments."]}}},
            status=400,
        )

    # Resolve optional project
    project = None
    project_id = data.get("project")
    if project_id:
        project = _validate_project_for_user(project_id, request.user)
        if not project:
            return Response(
                {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
                status=404,
            )

    payment_kwargs = {
        "organization_id": membership.organization_id,
        "customer": customer,
        "project": project,
        "direction": data["direction"],
        "method": data["method"],
        "status": data.get("status", Payment.Status.SETTLED),
        "amount": data["amount"],
        "payment_date": data.get("payment_date") or timezone.localdate(),
        "reference_number": data.get("reference_number", ""),
        "notes": data.get("notes", ""),
        "created_by": request.user,
    }

    # Resolve target document
    target_fields = {}
    target = _resolve_and_link_target(data, payment_kwargs, membership, target_fields)
    if target_fields:
        return Response(
            {"error": {"code": "validation_error", "message": "Invalid target.", "fields": target_fields}},
            status=400,
        )

    with transaction.atomic():
        payment = Payment.objects.create(**payment_kwargs)
        PaymentRecord.record(
            payment=payment,
            event_type=PaymentRecord.EventType.CREATED,
            capture_source=PaymentRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=None,
            to_status=payment.status,
            note="Payment created.",
            metadata={"direction": payment.direction, "method": payment.method},
        )
        if target and payment.status == Payment.Status.SETTLED:
            _recalculate_target_balance(target, payment.target_type, request.user)

    return Response({"data": PaymentSerializer(payment).data}, status=201)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_payments_view(request, project_id: int):
    """Project-scoped payment endpoint: GET lists project payments, POST creates attached to project."""
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    membership = _ensure_org_membership(request.user)

    if request.method == "GET":
        rows = (
            Payment.objects.filter(project=project)
            .select_related("project", "invoice", "vendor_bill", "receipt")
            .order_by("-payment_date", "-created_at")
        )
        return Response({"data": PaymentSerializer(rows, many=True).data})

    permission_error, _ = _capability_gate(request.user, "payments", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = PaymentWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    fields = {}
    if "direction" not in data:
        fields["direction"] = ["This field is required."]
    if "method" not in data:
        fields["method"] = ["This field is required."]
    if "amount" not in data:
        fields["amount"] = ["This field is required."]
    if fields:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing required fields.", "fields": fields}},
            status=400,
        )

    payment_kwargs = {
        "organization_id": project.organization_id,
        "customer": project.customer if data.get("direction") == Payment.Direction.INBOUND else None,
        "project": project,
        "direction": data["direction"],
        "method": data["method"],
        "status": data.get("status", Payment.Status.SETTLED),
        "amount": data["amount"],
        "payment_date": data.get("payment_date") or timezone.localdate(),
        "reference_number": data.get("reference_number", ""),
        "notes": data.get("notes", ""),
        "created_by": request.user,
    }

    # Resolve target document
    target_fields = {}
    target = _resolve_and_link_target(data, payment_kwargs, membership, target_fields)
    if target_fields:
        return Response(
            {"error": {"code": "validation_error", "message": "Invalid target.", "fields": target_fields}},
            status=400,
        )

    with transaction.atomic():
        payment = Payment.objects.create(**payment_kwargs)
        PaymentRecord.record(
            payment=payment,
            event_type=PaymentRecord.EventType.CREATED,
            capture_source=PaymentRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=None,
            to_status=payment.status,
            note="Payment created.",
            metadata={"direction": payment.direction, "method": payment.method},
        )
        if target and payment.status == Payment.Status.SETTLED:
            _recalculate_target_balance(target, payment.target_type, request.user)

    return Response({"data": PaymentSerializer(payment).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def payment_detail_view(request, payment_id: int):
    """Fetch or update a payment."""
    membership = _ensure_org_membership(request.user)
    try:
        payment = Payment.objects.select_related(
            "customer", "project", "invoice", "vendor_bill", "receipt",
        ).get(
            id=payment_id,
            organization_id=membership.organization_id,
        )
    except Payment.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Payment not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": PaymentSerializer(payment).data})

    permission_error, _ = _capability_gate(request.user, "payments", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = PaymentWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    previous_status = payment.status

    if "status" in data and not Payment.is_transition_allowed(
        current_status=payment.status,
        next_status=data["status"],
    ):
        return Response(
            {"error": {"code": "validation_error", "message": f"Invalid payment status transition: {payment.status} -> {data['status']}.", "fields": {"status": ["This transition is not allowed."]}}},
            status=400,
        )

    # Direction changes are blocked when a target is linked
    if "direction" in data and data["direction"] != payment.direction and payment.target_type:
        return Response(
            {"error": {"code": "validation_error", "message": "Cannot change payment direction when linked to a document.", "fields": {"direction": ["Unlink the document before changing direction."]}}},
            status=400,
        )

    # Amount and method are immutable after creation — void and recreate instead
    if "amount" in data and data["amount"] != payment.amount:
        return Response(
            {"error": {"code": "validation_error", "message": "Payment amount cannot be changed. Void this payment and create a new one.", "fields": {"amount": ["Amount is locked after creation."]}}},
            status=400,
        )
    if "method" in data and data["method"] != payment.method:
        return Response(
            {"error": {"code": "validation_error", "message": "Payment method cannot be changed. Void this payment and create a new one.", "fields": {"method": ["Method is locked after creation."]}}},
            status=400,
        )

    update_fields = ["updated_at"]
    for field in ["direction", "status", "payment_date", "reference_number", "notes"]:
        if field in data:
            setattr(payment, field, data[field])
            update_fields.append(field)

    with transaction.atomic():
        if len(update_fields) > 1:
            payment.save(update_fields=update_fields)

        status_changed = payment.status != previous_status
        if status_changed and {previous_status, payment.status} & {Payment.Status.SETTLED}:
            _recalculate_payment_target(payment, changed_by=request.user)

        if len(update_fields) > 1:
            PaymentRecord.record(
                payment=payment,
                event_type=(
                    PaymentRecord.EventType.STATUS_CHANGED
                    if status_changed
                    else PaymentRecord.EventType.UPDATED
                ),
                capture_source=PaymentRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                from_status=previous_status,
                to_status=payment.status,
                note="Payment updated.",
                metadata={
                    "direction": payment.direction,
                    "method": payment.method,
                    "status_changed": status_changed,
                },
            )

    payment.refresh_from_db()
    return Response({"data": PaymentSerializer(payment).data})
