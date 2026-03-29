"""Change-order creation, revision, and lifecycle endpoints."""

import logging

from decimal import Decimal

logger = logging.getLogger(__name__)

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    ChangeOrderSnapshot,
    ChangeOrderStatusEvent,
    Estimate,
    Project,
    SigningCeremonyRecord,
)
from core.policies import get_change_order_policy_contract
from core.serializers import ChangeOrderSerializer, ChangeOrderStatusEventSerializer, ChangeOrderWriteSerializer, EstimateLineItemSerializer
from core.serializers import ChangeOrderSerializer as _ChangeOrderSerializerForHash
from core.utils.money import MONEY_ZERO, quantize_money
from django_q.tasks import async_task
from core.utils.request import get_client_ip
from core.utils.signing import compute_document_content_hash
from core.views.change_orders.change_orders_helpers import (
    CO_DECISION_TO_STATUS,
    CONTRACT_PDF_ALLOWED_CONTENT_TYPES,
    CONTRACT_PDF_MAX_SIZE_BYTES,
    _handle_co_document_save,
    _handle_co_status_note,
    _handle_co_status_transition,
    _next_change_order_family_key,
    _prefetch_change_order_qs,
    _sync_change_order_lines,
    _validate_change_order_lines,
)
from core.views.helpers import (
    _build_public_decision_note,
    _capability_gate,
    _check_project_accepts_document,
    _ensure_org_membership,
    _resolve_organization_for_public_actor,
    _serialize_public_organization_context,
    _serialize_public_project_context,
    _validate_project_for_user,
)
from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision


@api_view(["GET"])
@permission_classes([AllowAny])
def public_change_order_detail_view(request, public_token):
    """Return public change-order detail for customer share links.

    Loads the change order by public token with project, customer,
    estimate, and line-item relations.  Enriches the response with
    project context, organization context, and signing ceremony consent.

    Flow:
        1. Look up change order by public token.
        2. Reject draft documents (not yet sent to customer).
        3. Serialize with public context and ceremony consent text.

    URL: ``GET /api/v1/public/change-order/<public_token>/detail/``

    Request body: (none)

    Success 200::

        { "data": { ..., "project_context": {...}, "ceremony_consent_text": "..." } }

    Errors:
        - 404: Change order not found or still in draft status.
    """
    try:
        change_order = _prefetch_change_order_qs(
            ChangeOrder.objects.filter(public_token=public_token)
        ).prefetch_related(
            "origin_estimate__line_items",
            "origin_estimate__line_items__cost_code",
        ).get()
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    if change_order.status == ChangeOrder.Status.DRAFT:
        return Response(
            {"error": {"code": "not_available", "message": "This change order is not yet available.", "fields": {}}},
            status=404,
        )

    serialized = ChangeOrderSerializer(change_order).data
    organization = _resolve_organization_for_public_actor(change_order.requested_by)
    serialized["project_context"] = _serialize_public_project_context(change_order.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization, request=request)
    if change_order.origin_estimate_id:
        estimate = change_order.origin_estimate
        serialized["origin_estimate_context"] = {
            "id": estimate.id,
            "title": estimate.title,
            "version": estimate.version,
            "public_ref": estimate.public_ref,
            "grand_total": str(estimate.grand_total),
            "line_items": EstimateLineItemSerializer(
                estimate.line_items.select_related("cost_code").all(), many=True
            ).data,
        }
        sibling_cos = (
            ChangeOrder.objects.filter(
                origin_estimate_id=estimate.id,
                status__in=["approved", "accepted"],
            )
            .exclude(id=change_order.id)
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("created_at", "id")
        )
        serialized["approved_sibling_change_orders"] = [
            ChangeOrderSerializer(co).data for co in sibling_cos
        ]
    consent_text, consent_version = get_ceremony_context()
    serialized["ceremony_consent_text"] = consent_text
    serialized["ceremony_consent_text_version"] = consent_version
    return Response({"data": serialized})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_change_order_decision_view(request, public_token):
    """Apply a customer approve/reject decision through a public change-order link.

    Validates the decision, confirms the CO is in ``sent``
    status, runs signing ceremony verification, then atomically
    transitions the status, propagates financial deltas to the project
    contract value, and records audit snapshots and signing ceremony.

    Flow:
        1. Look up change order by public token.
        2. Validate decision (approve/reject) and current status.
        3. Validate signing ceremony (OTP session).
        4. Transition status, propagate financials, record snapshot (atomic).
        5. Record signing ceremony with content hash.

    URL: ``POST /api/v1/public/change-order/<public_token>/decision/``

    Request body::

        { "decision": "approve", "note": "Approved scope addition" }

    Success 200::

        { "data": { ... }, "meta": { "applied_financial_delta": "5000.00" } }

    Errors:
        - 400: Invalid decision value.
        - 404: Change order not found.
        - 409: Change order not in ``sent`` status.
    """
    try:
        change_order = _prefetch_change_order_qs(
            ChangeOrder.objects.filter(public_token=public_token)
        ).get()
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    decision = str(request.data.get("decision", "")).strip().lower()
    if not (next_status := CO_DECISION_TO_STATUS.get(decision)):
        return Response(
            {"error": {"code": "validation_error", "message": "Invalid public decision for change order.", "fields": {"decision": ["Use 'approve' or 'reject'."]}}},
            status=400,
        )

    if change_order.status != ChangeOrder.Status.SENT:
        return Response(
            {
                "error": {
                    "code": "conflict",
                    "message": "This change order is not awaiting customer approval.",
                    "fields": {
                        "status": [f"Current status is '{change_order.status}'."],
                    },
                }
            },
            status=409,
        )

    # --- Ceremony validation ---
    customer_email = (change_order.project.customer.email or "").strip()
    ceremony_session, signer_name, ceremony_error = validate_ceremony_on_decision(
        request, public_token, customer_email,
    )
    if ceremony_error:
        return ceremony_error

    decision_note = _build_public_decision_note(
        action_label="Approved" if next_status == ChangeOrder.Status.APPROVED else "Rejected",
        note=str(request.data.get("note", "") or ""),
        decider_name=signer_name,
        decider_email=ceremony_session.recipient_email if ceremony_session else "",
    )

    previous_status = change_order.status
    financial_delta = MONEY_ZERO
    update_fields = ["status", "updated_at"]
    if next_status == ChangeOrder.Status.APPROVED:
        financial_delta = quantize_money(change_order.amount_delta)
        change_order.approved_by = change_order.requested_by
        change_order.approved_at = timezone.now()
        update_fields.extend(["approved_by", "approved_at"])

    consent_text, consent_version = get_ceremony_context()
    client_ip = get_client_ip(request)
    client_ua = request.META.get("HTTP_USER_AGENT", "")
    with transaction.atomic():
        change_order.status = next_status
        change_order.save(update_fields=update_fields)
        if financial_delta != MONEY_ZERO:
            Project.objects.filter(id=change_order.project_id).update(
                contract_value_current=F("contract_value_current") + financial_delta,
            )
        ChangeOrderSnapshot.record(
            change_order=change_order,
            decision_status=next_status,
            previous_status=previous_status,
            applied_financial_delta=financial_delta,
            decided_by=change_order.requested_by,
            ip_address=client_ip,
            user_agent=client_ua,
        )

        content_hash = compute_document_content_hash(
            "change_order", _ChangeOrderSerializerForHash(change_order).data,
        )
        SigningCeremonyRecord.record(
            document_type="change_order",
            document_id=change_order.id,
            public_token=public_token,
            decision=decision,
            signer_name=signer_name,
            signer_email=ceremony_session.recipient_email if ceremony_session else "",
            email_verified=ceremony_session is not None,
            content_hash=content_hash,
            ip_address=client_ip,
            user_agent=client_ua,
            consent_text_version=consent_version,
            consent_text_snapshot=consent_text,
            note=str(request.data.get("note", "") or "").strip(),
            access_session=ceremony_session,
        )
        ChangeOrderStatusEvent.record(
            change_order=change_order,
            from_status=previous_status,
            to_status=next_status,
            note=f"{decision_note} (via public link)",
            changed_by=change_order.requested_by,
            ip_address=client_ip,
            user_agent=client_ua,
        )

    logger.info("Change order public decision: id=%s CO-%s decision=%s delta=$%s from=%s", change_order.id, change_order.family_key, decision, financial_delta, client_ip)

    # Queue push + email notification to document owner (non-blocking).
    async_task(
        "core.tasks.send_document_decision_notification",
        change_order.requested_by_id,
        "change_order",
        change_order.title,
        change_order.project.customer.display_name,
        decision,
        f"/projects/{change_order.project_id}/estimates",
    )

    refreshed = _prefetch_change_order_qs(ChangeOrder.objects.filter(id=change_order.id)).get()

    serialized = ChangeOrderSerializer(refreshed).data
    organization = _resolve_organization_for_public_actor(refreshed.requested_by)
    serialized["project_context"] = _serialize_public_project_context(refreshed.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization, request=request)
    if refreshed.origin_estimate_id:
        estimate = refreshed.origin_estimate
        serialized["origin_estimate_context"] = {
            "id": estimate.id,
            "title": estimate.title,
            "version": estimate.version,
            "public_ref": estimate.public_ref,
            "grand_total": str(estimate.grand_total),
            "line_items": EstimateLineItemSerializer(
                estimate.line_items.select_related("cost_code").all(), many=True
            ).data,
        }
        sibling_cos = (
            ChangeOrder.objects.filter(
                origin_estimate_id=estimate.id,
                status__in=["approved", "accepted"],
            )
            .exclude(id=refreshed.id)
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("created_at", "id")
        )
        serialized["approved_sibling_change_orders"] = [
            ChangeOrderSerializer(co).data for co in sibling_cos
        ]

    return Response(
        {
            "data": serialized,
            "meta": {"applied_financial_delta": str(financial_delta)},
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def change_order_contract_view(_request):
    """Return the canonical change-order workflow policy contract.

    Read-only endpoint that returns status definitions, allowed transitions,
    and role requirements.  Used by the frontend to gate UI elements without
    hard-coding business rules.

    Flow:
        1. Return the change-order policy contract payload.

    URL: ``GET /api/v1/change-orders/contract/``

    Request body: (none)

    Success 200::

        { "data": { "statuses": [...], "transitions": [...] } }
    """
    return Response({"data": get_change_order_policy_contract()})


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
def change_order_contract_pdf_upload_view(request, change_order_id):
    """Upload, replace, or delete the contract PDF attached to a change order.

    POST accepts ``multipart/form-data`` with a single ``contract_pdf`` file
    field.  Validates content type (PDF only) and size (10 MB max).  If a
    previous file exists it is deleted before saving the new one.

    DELETE removes the attached contract PDF if one exists.

    Flow:
        1. Capability gate: ``change_orders.edit``.
        2. Validate change order is in the user's org.
        3. (POST) Validate file presence, content type, and size.
        4. Delete previous file if one exists.
        5. Save new file (POST) or clear field (DELETE).

    URL: ``POST/DELETE /api/v1/change-orders/<change_order_id>/contract-pdf/``

    Request body (POST): ``multipart/form-data`` with ``contract_pdf`` file field.

    Success 200::

        { "data": { ... } }

    Errors:
        - 400: No file provided, unsupported content type, or file too large.
        - 403: Missing ``change_orders.edit`` capability.
        - 404: Change order not found.
    """
    permission_error, _ = _capability_gate(request.user, "change_orders", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_org_membership(request.user)
    try:
        change_order = ChangeOrder.objects.get(
            id=change_order_id,
            project__organization_id=membership.organization_id,
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    previous_url = request.build_absolute_uri(change_order.contract_pdf.url) if change_order.contract_pdf else ""

    if request.method == "DELETE":
        if change_order.contract_pdf:
            change_order.contract_pdf = ""
            change_order.save(update_fields=["contract_pdf", "updated_at"])
            ChangeOrderStatusEvent.record(
                change_order=change_order,
                from_status=change_order.status,
                to_status=change_order.status,
                note=f"Contract PDF removed (previous: {previous_url}).",
                changed_by=request.user,
            )
        return Response({"data": ChangeOrderSerializer(change_order, context={"request": request}).data})

    # POST — upload/replace
    pdf_file = request.FILES.get("contract_pdf")
    if not pdf_file:
        return Response(
            {"error": {"code": "validation_error", "message": "No contract PDF file provided.", "fields": {}}},
            status=400,
        )

    if pdf_file.content_type not in CONTRACT_PDF_ALLOWED_CONTENT_TYPES:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Unsupported file type: {pdf_file.content_type}. Only PDF files are accepted.",
                    "fields": {},
                }
            },
            status=400,
        )

    if pdf_file.size > CONTRACT_PDF_MAX_SIZE_BYTES:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Contract PDF exceeds 10 MB size limit.",
                    "fields": {},
                }
            },
            status=400,
        )

    change_order.contract_pdf = pdf_file
    change_order.save(update_fields=["contract_pdf", "updated_at"])

    if previous_url:
        note = f"Contract PDF replaced: {pdf_file.name} (previous: {previous_url})."
    else:
        note = f"Contract PDF attached: {pdf_file.name}."
    ChangeOrderStatusEvent.record(
        change_order=change_order,
        from_status=change_order.status,
        to_status=change_order.status,
        note=note,
        changed_by=request.user,
    )

    return Response({"data": ChangeOrderSerializer(change_order, context={"request": request}).data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_change_orders_view(request, project_id):
    """List project change orders or create a new family revision-1 draft.

    GET returns all change orders for the project with line items and a
    latest-revision map for frontend UI gating.  POST creates a new
    change-order family (revision 1) requiring an approved origin
    estimate, valid line totals matching the amount delta, and atomic
    creation of the CO row plus optional line items.

    Flow (GET):
        1. Validate project scope.
        2. Query all COs with line items.
        3. Compute latest-revision map via subquery.
        4. Return serialized list with revision context.

    Flow (POST):
        1. Capability gate: ``change_orders.create``.
        1b. Reject if project is cancelled or completed (terminal guard).
        2. Validate required fields (title, amount_delta, origin_estimate).
        3. Validate origin estimate exists, is project-scoped, and approved.
        4. Validate line items and amount consistency.
        5. Create change order + lines (atomic).

    URL: ``GET/POST /api/v1/projects/<project_id>/change-orders/``

    Request body (POST)::

        { "title": "Scope Addition", "amount_delta": "5000.00", "origin_estimate": 42, "line_items": [...] }

    Success 200 (GET)::

        { "data": [{ ... }, ...] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Validation error (missing fields, invalid estimate, line mismatch).
        - 403: Missing ``change_orders.create`` capability.
        - 404: Project not found.
    """
    membership = _ensure_org_membership(request.user)
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        change_orders = (
            ChangeOrder.objects.filter(project=project)
            .prefetch_related("line_items", "line_items__cost_code", "sections")
            .order_by("-created_at")
        )
        return Response(
            {"data": ChangeOrderSerializer(change_orders, many=True, context={"request": request}).data}
        )

    elif request.method == "POST":
        permission_error, _ = _capability_gate(request.user, "change_orders", "create")
        if permission_error:
            return Response(permission_error, status=403)

        terminal_error = _check_project_accepts_document(project, "change orders")
        if terminal_error:
            return terminal_error

        serializer = ChangeOrderWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        organization = membership.organization
        incoming_line_items = data.get("line_items", [])
        origin_estimate = None
        reason_text = (
            str(data["reason"]).strip()
            if "reason" in data
            else ""
        )
        terms_text = (
            str(data["terms_text"]).strip()
            if "terms_text" in data
            else (organization.change_order_terms_and_conditions or "").strip()
        )

        fields = {}
        if "title" not in data:
            fields["title"] = ["This field is required."]
        if "amount_delta" not in data:
            fields["amount_delta"] = ["This field is required."]
        if fields:
            return Response(
                {"error": {"code": "validation_error", "message": "Missing required fields for change order creation.", "fields": fields}},
                status=400,
            )

        if "origin_estimate" not in data or data["origin_estimate"] is None:
            return Response(
                {"error": {"code": "validation_error", "message": "Change orders require an approved origin estimate.", "fields": {"origin_estimate": ["Select an approved estimate from this project."]}}},
                status=400,
            )
        try:
            origin_estimate = Estimate.objects.get(
                id=data["origin_estimate"],
                project=project,
            )
        except Estimate.DoesNotExist:
            return Response(
                {"error": {"code": "validation_error", "message": "origin_estimate is invalid for this project.", "fields": {"origin_estimate": ["Use an estimate from this project."]}}},
                status=400,
            )
        if origin_estimate.status != Estimate.Status.APPROVED:
            return Response(
                {"error": {"code": "validation_error", "message": "Change orders require an approved origin estimate.", "fields": {"origin_estimate": ["Only approved estimates can be used as CO origin."]}}},
                status=400,
            )

        cost_code_map = {}
        line_total_delta = MONEY_ZERO
        if incoming_line_items:
            cost_code_map, line_total_delta, line_error = _validate_change_order_lines(
                line_items=incoming_line_items,
                organization_id=organization.id,
            )
            if line_error:
                return Response(line_error, status=400)
            if line_total_delta != Decimal(str(data["amount_delta"])):
                return Response(
                    {"error": {"code": "validation_error", "message": "Line-item total must match change-order amount delta.", "fields": {"line_items": ["Sum of line item amount_delta must equal amount_delta."]}}},
                    status=400,
                )

        sender_logo_url = ""
        if organization.logo:
            sender_logo_url = request.build_absolute_uri(organization.logo.url)

        try:
            with transaction.atomic():
                change_order = ChangeOrder.objects.create(
                    project=project,
                    family_key=_next_change_order_family_key(project=project),
                    title=data["title"],
                    status=ChangeOrder.Status.DRAFT,
                    amount_delta=data["amount_delta"],
                    days_delta=data.get("days_delta", 0),
                    reason=reason_text,
                    terms_text=terms_text,
                    sender_name=(organization.display_name or "").strip(),
                    sender_address=organization.formatted_billing_address,
                    sender_logo_url=sender_logo_url,
                    origin_estimate=origin_estimate,
                    requested_by=request.user,
                )
                if incoming_line_items:
                    _sync_change_order_lines(
                        change_order=change_order,
                        line_items=incoming_line_items,
                        cost_code_map=cost_code_map,
                        sections_data=data.get("sections"),
                    )
        except ValidationError as exc:
            fields = exc.message_dict if hasattr(exc, "message_dict") else {"non_field_errors": exc.messages}
            return Response(
                {"error": {"code": "validation_error", "message": "Change-order line items are invalid for this project/budget context.", "fields": fields}},
                status=400,
            )
        change_order.refresh_from_db()
        ChangeOrderStatusEvent.record(
            change_order=change_order,
            from_status=None,
            to_status=change_order.status,
            note="Change order created.",
            changed_by=request.user,
        )
        created = _prefetch_change_order_qs(ChangeOrder.objects.filter(id=change_order.id)).get()
        return Response({"data": ChangeOrderSerializer(created, context={"request": request}).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def change_order_detail_view(request, change_order_id):
    """Fetch or update a change order with revision and status enforcement.

    GET returns the change-order detail.  PATCH supports three concern
    paths: status transitions (with capability gates and financial
    propagation), status notes (no-op for COs), and document saves
    (content field + line-item updates).  Only the latest revision can
    be edited, and only drafts allow content changes.

    Flow (GET):
        1. Look up change order scoped to user's org.
        2. Return serialized change order.

    Flow (PATCH):
        1. Capability gate: ``change_orders.edit``.
        2. Additional gates for send (``change_orders.send``) and
           approve/void (``change_orders.approve``).
        3. Reject edits on non-latest revisions and non-draft content edits.
        4. Dispatch to status-transition, status-note, or document-save handler.

    URL: ``GET/PATCH /api/v1/change-orders/<change_order_id>/``

    Request body (PATCH)::

        { "status": "sent" }

    Success 200::

        { "data": { ... }, "email_sent": false }

    Errors:
        - 400: Non-latest revision, non-draft content edit, invalid transition.
        - 403: Missing capability for the requested action.
        - 404: Change order not found.
    """
    membership = _ensure_org_membership(request.user)
    try:
        change_order = _prefetch_change_order_qs(
            ChangeOrder.objects.filter(
                id=change_order_id,
                project__organization_id=membership.organization_id,
            )
        ).get()
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": ChangeOrderSerializer(change_order, context={"request": request}).data})

    elif request.method == "PATCH":
        permission_error, _ = _capability_gate(request.user, "change_orders", "edit")
        if permission_error:
            return Response(permission_error, status=403)

        serializer = ChangeOrderWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Status-transition capability gates
        if "status" in data:
            requested_status = data["status"]
            if requested_status == ChangeOrder.Status.SENT:
                permission_error, _ = _capability_gate(request.user, "change_orders", "send")
                if permission_error:
                    return Response(permission_error, status=403)
            elif requested_status in {ChangeOrder.Status.APPROVED, ChangeOrder.Status.VOID}:
                permission_error, _ = _capability_gate(request.user, "change_orders", "approve")
                if permission_error:
                    return Response(permission_error, status=403)

        content_fields = {"title", "reason", "amount_delta", "days_delta", "origin_estimate", "line_items", "sections"}
        attempted_content_fields = sorted(field for field in content_fields if field in data)

        if change_order.status != ChangeOrder.Status.DRAFT:
            if attempted_content_fields:
                return Response(
                    {"error": {"code": "validation_error", "message": "Only draft change orders can edit content fields.", "fields": {field: ["This field is read-only after draft."] for field in attempted_content_fields}}},
                    status=400,
                )

        # --- Concern dispatch ---
        previous_status = change_order.status
        next_status = data.get("status", previous_status)
        status_changing = "status" in data
        is_actual_transition = status_changing and previous_status != next_status
        is_resend = (
            status_changing
            and previous_status == ChangeOrder.Status.SENT
            and next_status == ChangeOrder.Status.SENT
        )
        status_note = (data.get("status_note", "") or "").strip()

        if is_actual_transition or is_resend:
            return _handle_co_status_transition(
                request, change_order, data, membership,
                previous_status, next_status, is_resend,
            )
        if status_note:
            return _handle_co_status_note(request, change_order, data)
        return _handle_co_document_save(request, change_order, data, membership)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def change_order_status_events_view(request, change_order_id):
    """Return the immutable status-transition audit trail for a change order.

    Flow:
        1. Look up change order scoped to user's org.
        2. Query all status events with related user and project data.

    URL: ``GET /api/v1/change-orders/<change_order_id>/status-events/``

    Request body: (none)

    Success 200::

        { "data": [{ "from_status": "draft", "to_status": "sent", ... }, ...] }

    Errors:
        - 404: Change order not found.
    """
    membership = _ensure_org_membership(request.user)
    try:
        change_order = ChangeOrder.objects.get(
            id=change_order_id,
            project__organization_id=membership.organization_id,
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    status_events = ChangeOrderStatusEvent.objects.filter(
        change_order=change_order,
    ).select_related(
        "changed_by",
        "change_order__project__customer",
    )
    return Response({"data": ChangeOrderStatusEventSerializer(status_events, many=True).data})
