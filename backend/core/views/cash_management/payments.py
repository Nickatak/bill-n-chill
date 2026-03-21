"""Cash-management payment endpoints."""

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Customer,
    Payment,
    PaymentRecord,
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
    _prefetch_payment_qs,
    _recalculate_payment_target,
    _recalculate_target_balance,
    _resolve_and_link_target,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def payment_contract_view(_request):
    """Return the canonical payment workflow policy contract.

    Read-only endpoint that returns status definitions, allowed transitions,
    direction/method enums, and target type rules.

    Flow:
        1. Return the payment policy contract payload.

    URL: ``GET /api/v1/payments/contract/``

    Request body: (none)

    Success 200::

        { "data": { "statuses": [...], "transitions": [...] } }
    """
    return Response({"data": get_payment_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def org_payments_view(request):
    """List all org payments or create a new payment.

    GET returns all payments for the organization.  POST creates a
    payment with required direction, method, amount, and target document
    (``target_type`` + ``target_id``).  Every payment must allocate to
    exactly one document.  Inbound payments require a customer.

    Flow (GET):
        1. Return all org payments with related objects.

    Flow (POST):
        1. Capability gate: ``payments.create``.
        2. Validate required fields (direction, method, amount).
        3. Resolve customer (required for inbound) and optional project.
        4. Resolve and validate required target document.
        5. Create payment + audit record (atomic).
        6. Recalculate target balance if settled.

    URL: ``GET/POST /api/v1/payments/``

    Request body (POST)::

        { "direction": "inbound", "method": "check", "amount": "1500.00", "customer": 5 }

    Success 200 (GET)::

        { "data": [{ ... }, ...] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Missing required fields or invalid target.
        - 403: Missing ``payments.create`` capability.
        - 404: Customer or project not found.
    """
    membership = _ensure_org_membership(request.user)

    if request.method == "GET":
        payments = _prefetch_payment_qs(
            Payment.objects.filter(organization_id=membership.organization_id)
        ).order_by("-payment_date", "-created_at")
        return Response({"data": PaymentSerializer(payments, many=True).data})

    elif request.method == "POST":
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

        target, target_error = _resolve_and_link_target(data, payment_kwargs, membership)
        if target_error:
            return Response(target_error, status=400)

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
def project_payments_view(request, project_id):
    """List project payments or create a new payment linked to the project.

    GET returns all payments for the project.  POST creates a payment
    pre-linked to the project with auto-resolved customer for inbound
    direction.  Requires target document (``target_type`` + ``target_id``).

    Flow (GET):
        1. Validate project scope.
        2. Return project payments with related objects.

    Flow (POST):
        1. Capability gate: ``payments.create``.
        2. Validate required fields (direction, method, amount).
        3. Resolve and validate required target document.
        4. Create payment + audit record (atomic).
        5. Recalculate target balance if settled.

    URL: ``GET/POST /api/v1/projects/<project_id>/payments/``

    Request body (POST)::

        { "direction": "inbound", "method": "check", "amount": "1500.00" }

    Success 200 (GET)::

        { "data": [{ ... }, ...] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Missing required fields or invalid target.
        - 403: Missing ``payments.create`` capability.
        - 404: Project not found.
    """
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    membership = _ensure_org_membership(request.user)

    if request.method == "GET":
        payments = _prefetch_payment_qs(
            Payment.objects.filter(project=project)
        ).order_by("-payment_date", "-created_at")
        return Response({"data": PaymentSerializer(payments, many=True).data})

    elif request.method == "POST":
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

        target, target_error = _resolve_and_link_target(data, payment_kwargs, membership)
        if target_error:
            return Response(target_error, status=400)

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
def payment_detail_view(request, payment_id):
    """Fetch or update a single payment.

    GET returns the payment detail.  PATCH applies partial updates with
    guards for immutable fields (amount, method), direction changes on
    linked payments, and status transition validation.  Balance
    recalculation is triggered when settled status changes.

    Flow (GET):
        1. Look up payment scoped to user's org.
        2. Return serialized payment.

    Flow (PATCH):
        1. Capability gate: ``payments.edit``.
        2. Validate status transition.
        3. Reject direction change on linked payments.
        4. Reject amount/method changes (immutable — void and recreate).
        5. Apply field updates + audit record (atomic).
        6. Recalculate target balance if settled status changed.

    URL: ``GET/PATCH /api/v1/payments/<payment_id>/``

    Request body (PATCH)::

        { "status": "void", "notes": "Duplicate entry" }

    Success 200::

        { "data": { ... } }

    Errors:
        - 400: Invalid transition, immutable field change, or direction change on linked payment.
        - 403: Missing ``payments.edit`` capability.
        - 404: Payment not found.
    """
    membership = _ensure_org_membership(request.user)
    try:
        payment = _prefetch_payment_qs(
            Payment.objects.filter(
                id=payment_id,
                organization_id=membership.organization_id,
            )
        ).get()
    except Payment.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Payment not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": PaymentSerializer(payment).data})

    elif request.method == "PATCH":
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

        if "direction" in data and data["direction"] != payment.direction and payment.target_type:
            return Response(
                {"error": {"code": "validation_error", "message": "Cannot change payment direction when linked to a document.", "fields": {"direction": ["Unlink the document before changing direction."]}}},
                status=400,
            )

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
