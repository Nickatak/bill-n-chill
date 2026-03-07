"""Change-order creation, revision, and lifecycle endpoints."""

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, Max, Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import (
    Budget,
    ChangeOrder,
    ChangeOrderSnapshot,
    Estimate,
    FinancialAuditEvent,
    Project,
)
from core.policies import get_change_order_policy_contract
from core.serializers import ChangeOrderSerializer, ChangeOrderWriteSerializer
from core.utils.email import send_document_sent_email
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.change_orders.change_orders_helpers import (
    _active_budget_for_project,
    _model_validation_error_response,
    _next_change_order_family_key,
    _serialize_public_change_order,
    _sync_change_order_lines,
    _validate_change_order_lines,
    _validation_error_response,
)
from core.models import SigningCeremonyRecord
from core.serializers import ChangeOrderSerializer as _ChangeOrderSerializerForHash
from core.utils.signing import compute_document_content_hash
from core.views.helpers import (
    _build_public_decision_note,
    _capability_gate,
    _ensure_membership,
    _validate_project_for_user,
)
from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision


@api_view(["GET"])
@permission_classes([AllowAny])
def public_change_order_detail_view(request, public_token: str):
    """Return public change-order detail for share links."""
    try:
        change_order = (
            ChangeOrder.objects.select_related(
                "project__customer",
                "origin_estimate",
                "requested_by",
                "approved_by",
            )
            .prefetch_related(
                "line_items",
                "line_items__budget_line",
                "line_items__budget_line__cost_code",
            )
            .get(public_token=public_token)
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    serialized = _serialize_public_change_order(change_order)
    consent_text, consent_version = get_ceremony_context()
    serialized["ceremony_consent_text"] = consent_text
    serialized["ceremony_consent_text_version"] = consent_version
    return Response({"data": serialized})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_change_order_decision_view(request, public_token: str):
    """Apply a customer decision to a public change-order share link."""
    try:
        change_order = (
            ChangeOrder.objects.select_related(
                "project",
                "project__customer",
                "origin_estimate",
                "requested_by",
            )
            .prefetch_related(
                "line_items",
                "line_items__budget_line",
                "line_items__budget_line__cost_code",
            )
            .get(public_token=public_token)
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    decision = str(request.data.get("decision", "")).strip().lower()
    decision_to_status = {
        "approve": ChangeOrder.Status.APPROVED,
        "approved": ChangeOrder.Status.APPROVED,
        "reject": ChangeOrder.Status.REJECTED,
        "rejected": ChangeOrder.Status.REJECTED,
    }
    next_status = decision_to_status.get(decision)
    if not next_status:
        return _validation_error_response(
            message="Invalid public decision for change order.",
            fields={"decision": ["Use 'approve' or 'reject'."]},
            rule="co_public_decision_invalid",
        )

    if change_order.status != ChangeOrder.Status.PENDING_APPROVAL:
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
    active_budget = None
    update_fields = ["status", "updated_at"]
    if next_status == ChangeOrder.Status.APPROVED:
        active_budget = _active_budget_for_project(
            project=change_order.project,
        )
        if not active_budget:
            return Response(
                {
                    "error": {
                        "code": "conflict",
                        "message": "Project must have an active budget before approving this change order.",
                        "fields": {"project": ["No active budget found."]},
                    }
                },
                status=409,
            )
        financial_delta = quantize_money(change_order.amount_delta)
        change_order.approved_by = change_order.requested_by
        change_order.approved_at = timezone.now()
        update_fields.extend(["approved_by", "approved_at"])

    consent_text, consent_version = get_ceremony_context()
    with transaction.atomic():
        change_order.status = next_status
        change_order.save(update_fields=update_fields)
        if financial_delta != MONEY_ZERO and active_budget is not None:
            Project.objects.filter(id=change_order.project_id).update(
                contract_value_current=F("contract_value_current") + financial_delta,
            )
            Budget.objects.filter(id=active_budget.id).update(
                approved_change_order_total=F("approved_change_order_total") + financial_delta,
            )
        FinancialAuditEvent.record(
            project=change_order.project,
            event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
            object_type="change_order",
            object_id=change_order.id,
            from_status=previous_status,
            to_status=next_status,
            amount=change_order.amount_delta,
            note=decision_note,
            created_by=change_order.requested_by,
            metadata={
                "family_key": change_order.family_key,
                "public_decision": True,
                "public_decision_value": decision,
                "status_action": "transition",
                "financial_delta": str(financial_delta),
            },
        )
        ChangeOrderSnapshot.record(
            change_order=change_order,
            decision_status=next_status,
            previous_status=previous_status,
            applied_financial_delta=financial_delta,
            decided_by=change_order.requested_by,
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
            ip_address=request.META.get("REMOTE_ADDR"),
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
            consent_text_version=consent_version,
            consent_text_snapshot=consent_text,
            note=str(request.data.get("note", "") or "").strip(),
            access_session=ceremony_session,
        )

    refreshed = (
        ChangeOrder.objects.filter(id=change_order.id)
        .select_related("project__customer", "origin_estimate", "requested_by", "approved_by")
        .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
        .get()
    )

    return Response(
        {
            "data": _serialize_public_change_order(refreshed),
            "meta": {"applied_financial_delta": str(financial_delta)},
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def change_order_contract_view(_request):
    """Return canonical change-order workflow policy for frontend UX guards.

    Contract:
    - `GET`:
      - `200`: change-order policy contract returned.
        - Guarantees:
          - statuses/transitions mirror backend model-level transition guards. `[APP]`
          - no object mutations. `[APP]`
      - `401`: authentication missing/invalid.
        - Guarantees: no object mutations. `[APP]`

    - Preconditions:
      - caller must be authenticated (`IsAuthenticated`).

    - Object mutations:
      - `GET`: none.

    - Idempotency and retry semantics:
      - `GET` is idempotent and read-only.

    - Test anchors:
      - `backend/core/tests/test_change_orders.py::ChangeOrderTests::test_change_order_contract_requires_authentication`
      - `backend/core/tests/test_change_orders.py::ChangeOrderTests::test_change_order_contract_matches_model_transition_policy`
    """
    return Response({"data": get_change_order_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_change_orders_view(request, project_id: int):
    """List project change orders or create a new family revision-1 draft.

    Contract:
    - `GET`: project/user-scoped list with line items.
    - `POST`: requires role `owner|pm`, active budget, approved origin estimate, and valid line totals.
    - Create writes are atomic: change-order row, optional lines, financial audit event.
    """
    membership = _ensure_membership(request.user)
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            ChangeOrder.objects.filter(project=project)
            .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
            .order_by("-created_at", "-revision_number")
        )
        latest_ids = (
            ChangeOrder.objects.filter(project=project)
            .values("family_key")
            .annotate(latest_id=Max("id"))
            .values_list("latest_id", flat=True)
        )
        is_latest_revision_map = {pk: True for pk in latest_ids}
        return Response(
            {"data": ChangeOrderSerializer(rows, many=True, context={"is_latest_revision_map": is_latest_revision_map}).data}
        )

    permission_error, _ = _capability_gate(request.user, "change_orders", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = ChangeOrderWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    membership = _ensure_membership(request.user)
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
        return _validation_error_response(
            message="Missing required fields for change order creation.",
            fields=fields,
            rule="co_create_missing_required_fields",
        )

    active_budget = _active_budget_for_project(project=project)
    if not active_budget:
        return _validation_error_response(
            message="Project must have an active budget before creating change orders.",
            fields={"project": ["Create/activate a budget baseline first."]},
            rule="co_budget_active_required_for_propagation",
        )

    if "origin_estimate" not in data or data["origin_estimate"] is None:
        return _validation_error_response(
            message="Change orders require an approved origin estimate.",
            fields={"origin_estimate": ["Select an approved estimate from this project."]},
            rule="co_create_origin_estimate_required",
        )
    try:
        origin_estimate = Estimate.objects.get(
            id=data["origin_estimate"],
            project=project,
        )
    except Estimate.DoesNotExist:
        return _validation_error_response(
            message="origin_estimate is invalid for this project.",
            fields={"origin_estimate": ["Use an estimate from this project."]},
            rule="co_origin_estimate_project_scope",
        )
    if origin_estimate.status != Estimate.Status.APPROVED:
        return _validation_error_response(
            message="Change orders require an approved origin estimate.",
            fields={"origin_estimate": ["Only approved estimates can be used as CO origin."]},
            rule="co_origin_estimate_approved_required",
        )

    line_map = {}
    line_total_delta = MONEY_ZERO
    if incoming_line_items:
        line_map, line_total_delta, line_error = _validate_change_order_lines(
            project=project,
            line_items=incoming_line_items,
        )
        if line_error:
            return line_error
        if line_total_delta != Decimal(str(data["amount_delta"])):
            return _validation_error_response(
                message="Line-item total must match change-order amount delta.",
                fields={"line_items": ["Sum of line item amount_delta must equal amount_delta."]},
                rule="co_line_total_must_match_amount_delta",
            )

    try:
        with transaction.atomic():
            change_order = ChangeOrder.objects.create(
                project=project,
                family_key=_next_change_order_family_key(project=project),
                revision_number=1,
                title=data["title"],
                status=ChangeOrder.Status.DRAFT,
                amount_delta=data["amount_delta"],
                days_delta=data.get("days_delta", 0),
                reason=reason_text,
                terms_text=terms_text,
                origin_estimate=origin_estimate,
                requested_by=request.user,
            )
            FinancialAuditEvent.record(
                project=project,
                event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
                object_type="change_order",
                object_id=change_order.id,
                from_status="",
                to_status=ChangeOrder.Status.DRAFT,
                amount=change_order.amount_delta,
                note="Change order created.",
                created_by=request.user,
                metadata={"family_key": change_order.family_key},
            )
            if incoming_line_items:
                _sync_change_order_lines(
                    change_order=change_order,
                    line_items=incoming_line_items,
                    line_map=line_map,
                )
    except ValidationError as exc:
        return _model_validation_error_response(
            exc=exc,
            message="Change-order line items are invalid for this project/budget context.",
        )
    created = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(created).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def change_order_detail_view(request, change_order_id: int):
    """Fetch or update a change order with strict revision and status semantics.

    Contract:
    - `GET`: returns change-order detail.
    - `PATCH`: requires role `owner|pm`; only latest revision can be edited.
    - Enforces transition rules, line/amount consistency, and origin-estimate immutability policy.
    - Atomic update path may propagate financial deltas to project/budget and append immutable snapshot/audit rows.
    """
    membership = _ensure_membership(request.user)
    try:
        change_order = ChangeOrder.objects.select_related("project").prefetch_related(
            "line_items",
            "line_items__budget_line",
            "line_items__budget_line__cost_code",
        ).get(
            id=change_order_id,
            project__organization_id=membership.organization_id,
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": ChangeOrderSerializer(change_order).data})

    permission_error, _ = _capability_gate(request.user, "change_orders", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = ChangeOrderWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    # Status-transition capability gates
    if "status" in data:
        _next = data["status"]
        if _next == ChangeOrder.Status.PENDING_APPROVAL:
            _err, _ = _capability_gate(request.user, "change_orders", "send")
            if _err:
                return Response(_err, status=403)
        elif _next in {ChangeOrder.Status.APPROVED, ChangeOrder.Status.VOID}:
            _err, _ = _capability_gate(request.user, "change_orders", "approve")
            if _err:
                return Response(_err, status=403)

    incoming_line_items = data.get("line_items", None)
    content_fields = {"title", "reason", "amount_delta", "days_delta", "origin_estimate", "line_items"}
    attempted_content_fields = sorted(field for field in content_fields if field in data)

    latest_revision_exists = ChangeOrder.objects.filter(
        project=change_order.project,
        family_key=change_order.family_key,
        revision_number__gt=change_order.revision_number,
    ).exists()
    if latest_revision_exists and attempted_content_fields:
        return _validation_error_response(
            message="Only the latest change-order revision can be edited.",
            fields={"change_order": ["Create or edit the latest revision for this family."]},
            rule="co_edit_latest_revision_only",
        )
    if change_order.status != ChangeOrder.Status.DRAFT:
        if attempted_content_fields:
            return _validation_error_response(
                message="Only draft change orders can edit content fields.",
                fields={
                    field: ["This field is read-only after draft. Clone a new revision to change content."]
                    for field in attempted_content_fields
                },
                rule="co_edit_requires_draft_status",
            )

    previous_status = change_order.status
    current_amount_delta = quantize_money(change_order.amount_delta)
    next_amount_delta = quantize_money(data.get("amount_delta", current_amount_delta))
    status_note = (data.get("status_note", "") or "").strip()
    status_note_requested = status_note != ""
    status_changing = "status" in data
    next_status = data.get("status", previous_status)
    is_pending_resend = (
        status_changing
        and previous_status == ChangeOrder.Status.PENDING_APPROVAL
        and next_status == ChangeOrder.Status.PENDING_APPROVAL
    )
    same_status_note_request = status_changing and previous_status == next_status and status_note_requested
    if status_changing and not (is_pending_resend or same_status_note_request) and not ChangeOrder.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        return _validation_error_response(
            message=f"Invalid change order status transition: {previous_status} -> {next_status}.",
            fields={"status": ["This transition is not allowed."]},
            rule="co_status_transition_not_allowed",
        )

    financial_delta = MONEY_ZERO
    if previous_status != ChangeOrder.Status.APPROVED and next_status == ChangeOrder.Status.APPROVED:
        financial_delta = next_amount_delta
    elif previous_status == ChangeOrder.Status.APPROVED and next_status != ChangeOrder.Status.APPROVED:
        financial_delta = quantize_money(current_amount_delta * Decimal("-1"))
    elif (
        previous_status == ChangeOrder.Status.APPROVED
        and next_status == ChangeOrder.Status.APPROVED
        and "amount_delta" in data
    ):
        financial_delta = next_amount_delta - current_amount_delta

    active_budget = None
    if financial_delta != MONEY_ZERO:
        active_budget = _active_budget_for_project(
            project=change_order.project,
        )
        if not active_budget:
            return _validation_error_response(
                message="Project must have an active budget for change-order propagation.",
                fields={"project": ["Create/activate a budget baseline first."]},
                rule="co_budget_active_required_for_propagation",
            )

    if incoming_line_items is not None:
        line_map, line_total_delta, line_error = _validate_change_order_lines(
            project=change_order.project,
            line_items=incoming_line_items,
        )
        if line_error:
            return line_error
        if line_total_delta != next_amount_delta:
            return _validation_error_response(
                message="Line-item total must match change-order amount delta.",
                fields={"line_items": ["Sum of line item amount_delta must equal amount_delta."]},
                rule="co_line_total_must_match_amount_delta",
            )
    else:
        existing_line_total = change_order.line_items.aggregate(total=Sum("amount_delta")).get("total") or Decimal(
            "0.00"
        )
        if "amount_delta" in data and existing_line_total != Decimal("0.00") and existing_line_total != next_amount_delta:
            return _validation_error_response(
                message="Existing line items no longer match amount delta.",
                fields={
                    "amount_delta": [
                        "Update line_items with amount_delta so total remains consistent.",
                    ]
                },
                rule="co_line_total_must_match_amount_delta",
            )

    update_fields = ["updated_at"]
    if "origin_estimate" in data:
        if change_order.origin_estimate_id and data["origin_estimate"] != change_order.origin_estimate_id:
            return _validation_error_response(
                message="origin_estimate cannot be changed after being set.",
                fields={"origin_estimate": ["Create a new revision to change estimate linkage."]},
                rule="co_origin_estimate_immutable_once_set",
            )
        if data["origin_estimate"] is None:
            if change_order.origin_estimate_id is not None:
                return _validation_error_response(
                    message="origin_estimate cannot be cleared once set.",
                    fields={"origin_estimate": ["Create a new revision to remove estimate linkage."]},
                    rule="co_origin_estimate_immutable_once_set",
                )
        elif change_order.origin_estimate_id is None:
            try:
                origin_estimate = Estimate.objects.get(
                    id=data["origin_estimate"],
                    project=change_order.project,
                )
            except Estimate.DoesNotExist:
                return _validation_error_response(
                    message="origin_estimate is invalid for this project.",
                    fields={"origin_estimate": ["Use an estimate from this project."]},
                    rule="co_origin_estimate_project_scope",
                )
            if origin_estimate.status != Estimate.Status.APPROVED:
                return _validation_error_response(
                    message="Change orders require an approved origin estimate.",
                    fields={"origin_estimate": ["Only approved estimates can be used as CO origin."]},
                    rule="co_origin_estimate_approved_required",
                )
            change_order.origin_estimate = origin_estimate
            update_fields.append("origin_estimate")
    if "title" in data:
        change_order.title = data["title"]
        update_fields.append("title")
    if "amount_delta" in data:
        change_order.amount_delta = data["amount_delta"]
        update_fields.append("amount_delta")
    if "days_delta" in data:
        change_order.days_delta = data["days_delta"]
        update_fields.append("days_delta")
    if "reason" in data:
        change_order.reason = data["reason"]
        update_fields.append("reason")
    if "terms_text" in data:
        change_order.terms_text = data["terms_text"]
        update_fields.append("terms_text")
    if "status" in data:
        change_order.status = data["status"]
        update_fields.append("status")

    if status_changing and previous_status != next_status and next_status == ChangeOrder.Status.APPROVED:
        change_order.approved_by = request.user
        change_order.approved_at = timezone.now()
        update_fields.extend(["approved_by", "approved_at"])
    elif status_changing and previous_status != next_status and next_status != ChangeOrder.Status.APPROVED:
        if change_order.approved_by_id is not None:
            change_order.approved_by = None
            update_fields.append("approved_by")
        if change_order.approved_at is not None:
            change_order.approved_at = None
            update_fields.append("approved_at")

    try:
        with transaction.atomic():
            if len(update_fields) > 1:
                change_order.save(update_fields=update_fields)
            if incoming_line_items is not None:
                _sync_change_order_lines(
                    change_order=change_order,
                    line_items=incoming_line_items,
                    line_map=line_map,
                )
            if financial_delta != MONEY_ZERO:
                Project.objects.filter(
                    id=change_order.project_id,
                ).update(
                    contract_value_current=F("contract_value_current") + financial_delta,
                )
                Budget.objects.filter(id=active_budget.id).update(
                    approved_change_order_total=F("approved_change_order_total") + financial_delta,
                )
            should_record_audit_event = (
                previous_status != next_status
                or financial_delta != MONEY_ZERO
                or is_pending_resend
                or status_note_requested
            )
            if should_record_audit_event:
                status_action = "update"
                if status_note_requested and previous_status == next_status:
                    status_action = "notate"
                elif is_pending_resend:
                    status_action = "resend"
                elif previous_status != next_status:
                    status_action = "transition"
                if status_note_requested:
                    event_note = status_note
                elif is_pending_resend:
                    event_note = "Change order re-sent for approval."
                else:
                    event_note = "Change order status updated."
                if financial_delta != MONEY_ZERO:
                    event_note = f"{event_note} Financial delta applied: {financial_delta}."
                FinancialAuditEvent.record(
                    project=change_order.project,
                    event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
                    object_type="change_order",
                    object_id=change_order.id,
                    from_status=previous_status,
                    to_status=next_status,
                    amount=next_amount_delta,
                    note=event_note,
                    created_by=request.user,
                    metadata={
                        "family_key": change_order.family_key,
                        "financial_delta": str(financial_delta),
                        "status_note_logged": status_note_requested,
                        "status_action": status_action,
                    },
                )
            if (
                status_changing
                and previous_status != next_status
                and next_status in {
                    ChangeOrder.Status.APPROVED,
                    ChangeOrder.Status.REJECTED,
                    ChangeOrder.Status.VOID,
                }
            ):
                ChangeOrderSnapshot.record(
                    change_order=change_order,
                    decision_status=next_status,
                    previous_status=previous_status,
                    applied_financial_delta=financial_delta,
                    decided_by=request.user,
                )
    except ValidationError as exc:
        return _model_validation_error_response(
            exc=exc,
            message="Change-order line items are invalid for this project/budget context.",
        )

    if next_status == ChangeOrder.Status.PENDING_APPROVAL and (
        previous_status != ChangeOrder.Status.PENDING_APPROVAL or is_pending_resend
    ):
        customer_email = (change_order.project.customer.email or "").strip()
        if customer_email:
            send_document_sent_email(
                document_type="Change Order",
                document_title=f"CO-{change_order.family_key} v{change_order.revision_number}: {change_order.title}",
                public_url=f"{settings.FRONTEND_URL}/change-order/{change_order.public_ref}",
                recipient_email=customer_email,
                sender_user=request.user,
            )

    refreshed = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(refreshed).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_order_clone_revision_view(request, change_order_id: int):
    """Clone the latest change-order revision into a new draft revision in the same family.

    Contract:
    - Requires role `owner|pm`.
    - Source must be latest family revision.
    - Clone writes are atomic: cloned row, cloned lines, financial audit event.
    """
    membership = _ensure_membership(request.user)
    try:
        change_order = (
            ChangeOrder.objects.select_related("project", "origin_estimate")
            .prefetch_related("line_items")
            .get(id=change_order_id, project__organization_id=membership.organization_id)
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _capability_gate(request.user, "change_orders", "create")
    if permission_error:
        return Response(permission_error, status=403)

    latest = (
        ChangeOrder.objects.filter(
            project=change_order.project,
            family_key=change_order.family_key,
        )
        .order_by("-revision_number")
        .first()
    )
    if latest and latest.id != change_order.id:
        return _validation_error_response(
            message="Revisions can only be cloned from the latest family version.",
            fields={"change_order": ["Select the latest revision before cloning."]},
            rule="co_clone_requires_latest_revision",
        )

    next_revision = (latest.revision_number + 1) if latest else (change_order.revision_number + 1)
    with transaction.atomic():
        clone = ChangeOrder.objects.create(
            project=change_order.project,
            family_key=change_order.family_key,
            revision_number=next_revision,
            title=change_order.title,
            status=ChangeOrder.Status.DRAFT,
            amount_delta=change_order.amount_delta,
            days_delta=change_order.days_delta,
            reason=change_order.reason,
            terms_text=change_order.terms_text,
            origin_estimate=change_order.origin_estimate,
            previous_change_order=change_order,
            requested_by=request.user,
        )
        _sync_change_order_lines(
            change_order=clone,
            line_items=[
                {
                    "budget_line": line.budget_line_id,
                    "description": line.description,
                    "line_type": line.line_type,
                    "adjustment_reason": line.adjustment_reason,
                    "amount_delta": str(line.amount_delta),
                    "days_delta": line.days_delta,
                }
                for line in change_order.line_items.all()
            ],
            line_map={line.budget_line_id: line.budget_line for line in change_order.line_items.all()},
        )
        FinancialAuditEvent.record(
            project=clone.project,
            event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
            object_type="change_order",
            object_id=clone.id,
            from_status="",
            to_status=clone.status,
            amount=clone.amount_delta,
            note=f"Change order revision created from CO-{change_order.family_key} v{change_order.revision_number}.",
            created_by=request.user,
            metadata={
                "family_key": clone.family_key,
                "revision_number": clone.revision_number,
                "previous_change_order_id": change_order.id,
            },
        )
        if change_order.status in {ChangeOrder.Status.DRAFT, ChangeOrder.Status.PENDING_APPROVAL}:
            previous_status = change_order.status
            change_order.status = ChangeOrder.Status.VOID
            change_order.save(update_fields=["status", "updated_at"])
            FinancialAuditEvent.record(
                project=change_order.project,
                event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
                object_type="change_order",
                object_id=change_order.id,
                from_status=previous_status,
                to_status=change_order.status,
                amount=change_order.amount_delta,
                note=f"Superseded by CO-{clone.family_key} v{clone.revision_number}.",
                created_by=request.user,
                metadata={
                    "family_key": change_order.family_key,
                    "superseded_by_change_order_id": clone.id,
                },
            )
            ChangeOrderSnapshot.record(
                change_order=change_order,
                decision_status=ChangeOrder.Status.VOID,
                previous_status=previous_status,
                applied_financial_delta=MONEY_ZERO,
                decided_by=request.user,
            )

    created = (
        ChangeOrder.objects.filter(id=clone.id)
        .prefetch_related("line_items", "line_items__budget_line", "line_items__budget_line__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(created).data}, status=201)
