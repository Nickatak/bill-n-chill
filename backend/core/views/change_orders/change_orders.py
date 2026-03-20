"""Change-order creation, revision, and lifecycle endpoints."""

from decimal import Decimal

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, OuterRef, Subquery
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import (
    ChangeOrder,
    ChangeOrderSnapshot,
    Estimate,
    Project,
    SigningCeremonyRecord,
)
from core.policies import get_change_order_policy_contract
from core.serializers import ChangeOrderSerializer, ChangeOrderWriteSerializer
from core.serializers import ChangeOrderSerializer as _ChangeOrderSerializerForHash
from core.utils.money import MONEY_ZERO, quantize_money
from core.utils.request import get_client_ip
from core.utils.signing import compute_document_content_hash
from core.views.change_orders.change_orders_helpers import (
    _handle_co_document_save,
    _handle_co_status_note,
    _handle_co_status_transition,
    _model_validation_error_payload,
    _next_change_order_family_key,
    _serialize_public_change_order,
    _sync_change_order_lines,
    _validate_change_order_lines,
    _validation_error_payload,
)
from core.views.helpers import (
    _build_public_decision_note,
    _capability_gate,
    _ensure_org_membership,
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
                "line_items__cost_code",
                "origin_estimate__line_items",
                "origin_estimate__line_items__cost_code",
            )
            .get(public_token=public_token)
        )
    except ChangeOrder.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Change order not found.", "fields": {}}},
            status=404,
        )

    serialized = _serialize_public_change_order(change_order, request=request)
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
                "line_items__cost_code",
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
        return Response(*_validation_error_payload(
            message="Invalid public decision for change order.",
            fields={"decision": ["Use 'approve' or 'reject'."]},
            rule="co_public_decision_invalid",
        ))

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

    refreshed = (
        ChangeOrder.objects.filter(id=change_order.id)
        .select_related("project__customer", "origin_estimate", "requested_by", "approved_by")
        .prefetch_related("line_items", "line_items__cost_code")
        .get()
    )

    return Response(
        {
            "data": _serialize_public_change_order(refreshed, request=request),
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
    - `POST`: requires role `owner|pm`, approved origin estimate, and valid line totals.
    - Create writes are atomic: change-order row, optional lines.
    """
    membership = _ensure_org_membership(request.user)
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            ChangeOrder.objects.filter(project=project)
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("-created_at", "-revision_number")
        )
        max_rev_subquery = (
            ChangeOrder.objects.filter(
                project=project,
                family_key=OuterRef("family_key"),
            )
            .order_by("-revision_number")
            .values("id")[:1]
        )
        latest_ids = (
            ChangeOrder.objects.filter(project=project)
            .values("family_key")
            .annotate(latest_id=Subquery(max_rev_subquery))
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
    membership = _ensure_org_membership(request.user)
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
        return Response(*_validation_error_payload(
            message="Missing required fields for change order creation.",
            fields=fields,
            rule="co_create_missing_required_fields",
        ))

    if "origin_estimate" not in data or data["origin_estimate"] is None:
        return Response(*_validation_error_payload(
            message="Change orders require an approved origin estimate.",
            fields={"origin_estimate": ["Select an approved estimate from this project."]},
            rule="co_create_origin_estimate_required",
        ))
    try:
        origin_estimate = Estimate.objects.get(
            id=data["origin_estimate"],
            project=project,
        )
    except Estimate.DoesNotExist:
        return Response(*_validation_error_payload(
            message="origin_estimate is invalid for this project.",
            fields={"origin_estimate": ["Use an estimate from this project."]},
            rule="co_origin_estimate_project_scope",
        ))
    if origin_estimate.status != Estimate.Status.APPROVED:
        return Response(*_validation_error_payload(
            message="Change orders require an approved origin estimate.",
            fields={"origin_estimate": ["Only approved estimates can be used as CO origin."]},
            rule="co_origin_estimate_approved_required",
        ))

    cost_code_map = {}
    line_total_delta = MONEY_ZERO
    if incoming_line_items:
        cost_code_map, line_total_delta, line_error = _validate_change_order_lines(
            line_items=incoming_line_items,
            organization_id=organization.id,
        )
        if line_error:
            return Response(*line_error)
        if line_total_delta != Decimal(str(data["amount_delta"])):
            return Response(*_validation_error_payload(
                message="Line-item total must match change-order amount delta.",
                fields={"line_items": ["Sum of line item amount_delta must equal amount_delta."]},
                rule="co_line_total_must_match_amount_delta",
            ))

    sender_logo_url = ""
    if organization.logo:
        sender_logo_url = request.build_absolute_uri(organization.logo.url)

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
                )
    except ValidationError as exc:
        return Response(*_model_validation_error_payload(
            exc=exc,
            message="Change-order line items are invalid for this project/budget context.",
        ))
    created = (
        ChangeOrder.objects.filter(id=change_order.id)
        .prefetch_related("line_items", "line_items__cost_code")
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
    - Atomic update path may propagate financial deltas to project and append immutable snapshot rows.
    """
    membership = _ensure_org_membership(request.user)
    try:
        change_order = ChangeOrder.objects.select_related("project").prefetch_related(
            "line_items",
            "line_items__cost_code",
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
        return Response(*_validation_error_payload(
            message="Only the latest change-order revision can be edited.",
            fields={"change_order": ["Create or edit the latest revision for this family."]},
            rule="co_edit_latest_revision_only",
        ))
    if change_order.status != ChangeOrder.Status.DRAFT:
        if attempted_content_fields:
            return Response(*_validation_error_payload(
                message="Only draft change orders can edit content fields.",
                fields={
                    field: ["This field is read-only after draft. Clone a new revision to change content."]
                    for field in attempted_content_fields
                },
                rule="co_edit_requires_draft_status",
            ))

    # --- Concern dispatch ---
    previous_status = change_order.status
    next_status = data.get("status", previous_status)
    status_changing = "status" in data
    is_actual_transition = status_changing and previous_status != next_status
    is_resend = (
        status_changing
        and previous_status == ChangeOrder.Status.PENDING_APPROVAL
        and next_status == ChangeOrder.Status.PENDING_APPROVAL
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_order_clone_revision_view(request, change_order_id: int):
    """Clone the latest change-order revision into a new draft revision in the same family.

    Contract:
    - Requires role `owner|pm`.
    - Source must be latest family revision.
    - Clone writes are atomic: cloned row, cloned lines.
    """
    membership = _ensure_org_membership(request.user)
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
        return Response(*_validation_error_payload(
            message="Revisions can only be cloned from the latest family version.",
            fields={"change_order": ["Select the latest revision before cloning."]},
            rule="co_clone_requires_latest_revision",
        ))

    next_revision = (latest.revision_number + 1) if latest else (change_order.revision_number + 1)
    organization = membership.organization
    sender_logo_url = ""
    if organization.logo:
        sender_logo_url = request.build_absolute_uri(organization.logo.url)

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
            sender_name=(organization.display_name or "").strip(),
            sender_address=organization.formatted_billing_address,
            sender_logo_url=sender_logo_url,
            origin_estimate=change_order.origin_estimate,
            previous_change_order=change_order,
            requested_by=request.user,
        )
        source_lines = list(change_order.line_items.select_related("cost_code").all())
        _sync_change_order_lines(
            change_order=clone,
            line_items=[
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "adjustment_reason": line.adjustment_reason,
                    "amount_delta": str(line.amount_delta),
                    "days_delta": line.days_delta,
                }
                for line in source_lines
            ],
            cost_code_map={
                line.cost_code_id: line.cost_code
                for line in source_lines
                if line.cost_code_id
            },
        )
        if change_order.status in {ChangeOrder.Status.DRAFT, ChangeOrder.Status.PENDING_APPROVAL}:
            previous_status = change_order.status
            change_order.status = ChangeOrder.Status.VOID
            change_order.save(update_fields=["status", "updated_at"])
            ChangeOrderSnapshot.record(
                change_order=change_order,
                decision_status=ChangeOrder.Status.VOID,
                previous_status=previous_status,
                applied_financial_delta=MONEY_ZERO,
                decided_by=request.user,
            )

    created = (
        ChangeOrder.objects.filter(id=clone.id)
        .prefetch_related("line_items", "line_items__cost_code")
        .get()
    )
    return Response({"data": ChangeOrderSerializer(created).data}, status=201)
