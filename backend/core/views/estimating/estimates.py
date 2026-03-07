"""Estimate authoring, public sharing, and budget-conversion endpoints."""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import Estimate, EstimateStatusEvent
from core.policies import get_estimate_policy_contract
from core.serializers import (
    BudgetSerializer,
    EstimateDuplicateSerializer,
    EstimateSerializer,
    EstimateStatusEventSerializer,
    EstimateWriteSerializer,
)
from core.views.estimating.budgets_helpers import _ensure_budget_from_approved_estimate
from core.views.estimating.estimates_helpers import (
    _activate_project_from_estimate_approval,
    _apply_estimate_lines_and_totals,
    _archive_estimate_family,
    _next_estimate_family_version,
    _serialize_estimate,
    _serialize_estimates,
)
from core.models import SigningCeremonyRecord
from core.utils.signing import compute_document_content_hash
from core.views.helpers import (
    _build_public_decision_note,
    _capability_gate,
    _ensure_membership,
    _organization_user_ids,
    _parse_request_bool,
    _resolve_organization_for_public_actor,
    _serialize_public_organization_context,
    _serialize_public_project_context,
    _validate_project_for_user,
)
from core.utils.email import send_document_sent_email
from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision


@api_view(["GET"])
@permission_classes([AllowAny])
def public_estimate_detail_view(request, public_token: str):
    """Return public estimate detail for share links, including lightweight project context."""
    try:
        estimate = (
            Estimate.objects.select_related("project__customer", "created_by")
            .prefetch_related("line_items", "line_items__cost_code")
            .get(public_token=public_token)
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    serialized = EstimateSerializer(estimate).data
    organization = _resolve_organization_for_public_actor(estimate.created_by)
    serialized["project_context"] = _serialize_public_project_context(estimate.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization)
    consent_text, consent_version = get_ceremony_context()
    serialized["ceremony_consent_text"] = consent_text
    serialized["ceremony_consent_text_version"] = consent_version
    return Response({"data": serialized})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_estimate_decision_view(request, public_token: str):
    """Apply customer approve/reject decisions through public estimate share links."""
    try:
        estimate = (
            Estimate.objects.select_related("project__customer", "created_by")
            .prefetch_related("line_items", "line_items__cost_code")
            .get(public_token=public_token)
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    decision = str(request.data.get("decision", "")).strip().lower()
    decision_to_status = {
        "approve": Estimate.Status.APPROVED,
        "approved": Estimate.Status.APPROVED,
        "reject": Estimate.Status.REJECTED,
        "rejected": Estimate.Status.REJECTED,
    }
    next_status = decision_to_status.get(decision)
    if not next_status:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid public decision for estimate.",
                    "fields": {"decision": ["Use 'approve' or 'reject'."]},
                }
            },
            status=400,
        )

    if estimate.status != Estimate.Status.SENT:
        return Response(
            {
                "error": {
                    "code": "conflict",
                    "message": "This estimate is not awaiting customer approval.",
                    "fields": {"status": [f"Current status is '{estimate.status}'."]},
                }
            },
            status=409,
        )

    # --- Ceremony validation ---
    customer_email = (estimate.project.customer.email or "").strip()
    ceremony_session, signer_name, ceremony_error = validate_ceremony_on_decision(
        request, public_token, customer_email,
    )
    if ceremony_error:
        return ceremony_error

    decision_note = _build_public_decision_note(
        action_label="Approved" if next_status == Estimate.Status.APPROVED else "Rejected",
        note=str(request.data.get("note", "") or ""),
        decider_name=signer_name,
        decider_email=ceremony_session.recipient_email if ceremony_session else "",
    )

    previous_status = estimate.status
    budget_conversion_meta = {}
    consent_text, consent_version = get_ceremony_context()
    with transaction.atomic():
        estimate.status = next_status
        estimate.save(update_fields=["status", "updated_at"])
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=previous_status,
            to_status=estimate.status,
            note=decision_note,
            changed_by=estimate.created_by,
        )
        if estimate.status == Estimate.Status.APPROVED:
            _activate_project_from_estimate_approval(
                estimate=estimate,
                actor=estimate.created_by,
                note=f"Project moved to active after public approval of estimate #{estimate.id}.",
            )
            budget_row, conversion_status = _ensure_budget_from_approved_estimate(
                estimate=estimate,
                user=estimate.created_by,
                note=f"Budget auto-converted from publicly approved estimate #{estimate.id}.",
                allow_supersede=True,
            )
            budget_conversion_meta["budget_conversion_status"] = conversion_status

        content_hash = compute_document_content_hash("estimate", EstimateSerializer(estimate).data)
        SigningCeremonyRecord.record(
            document_type="estimate",
            document_id=estimate.id,
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

    actor_user_ids = _organization_user_ids(estimate.created_by)
    serialized = _serialize_estimate(estimate=estimate, actor_user_ids=actor_user_ids)
    organization = _resolve_organization_for_public_actor(estimate.created_by)
    serialized["project_context"] = _serialize_public_project_context(estimate.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization)

    response_payload = {"data": serialized}
    if budget_conversion_meta:
        response_payload["meta"] = budget_conversion_meta
    return Response(response_payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def estimate_contract_view(_request):
    """Return canonical estimate workflow policy for frontend UX guards.

    Contract:
    - `GET`:
      - `200`: estimate policy contract returned.
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
      - `backend/core/tests/test_estimates.py::EstimateTests::test_estimate_contract_requires_authentication`
      - `backend/core/tests/test_estimates.py::EstimateTests::test_estimate_contract_matches_model_transition_policy`
    """
    return Response({"data": get_estimate_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_estimates_view(request, project_id: int):
    """List project estimates or create a new estimate version within a title family.

    Contract:
    - `GET`: user/project-scoped list.
    - `POST`: requires role `owner|pm`, at least one line item, and valid cost-code scope.
    - Applies duplicate-submit suppression window and archives superseded family rows after create.
    """
    actor_user_ids = _organization_user_ids(request.user)
    membership = _ensure_membership(request.user)
    organization = membership.organization
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        estimates = (
            Estimate.objects.filter(project=project, created_by_id__in=actor_user_ids)
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("-version")
        )
        return Response(
            {
                "data": _serialize_estimates(
                    estimates=estimates,
                    project=project,
                    actor_user_ids=actor_user_ids,
                )
            }
        )

    permission_error, _ = _capability_gate(request.user, "estimates", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = EstimateWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    resolved_valid_through = data.get("valid_through")
    if resolved_valid_through is None:
        validation_delta_days = max(
            1,
            min(365, int(organization.default_estimate_valid_delta or 30)),
        )
        resolved_valid_through = timezone.localdate() + timedelta(days=validation_delta_days)
    if "terms_text" in data:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Estimate terms are managed by organization templates.",
                    "fields": {
                        "terms_text": [
                            "Set estimate terms in Organization settings; per-estimate overrides are disabled."
                        ]
                    },
                }
            },
            status=400,
        )
    line_items = data.get("line_items", [])
    if not line_items:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one line item is required.",
                    "fields": {"line_items": ["At least one line item is required."]},
                }
            },
            status=400,
        )

    def _line_items_signature(items):
        signature = []
        for item in items:
            signature.append(
                (
                    int(item["cost_code"]),
                    (item.get("description") or "").strip(),
                    str(item.get("quantity", "")),
                    (item.get("unit") or "").strip(),
                    str(item.get("unit_cost", "")),
                    str(item.get("markup_percent", "")),
                )
            )
        return signature

    def _estimate_signature(estimate):
        return [
            (
                item.cost_code_id,
                (item.description or "").strip(),
                str(item.quantity),
                (item.unit or "").strip(),
                str(item.unit_cost),
                str(item.markup_percent),
            )
            for item in estimate.line_items.all()
        ]

    input_signature = _line_items_signature(line_items)
    window_start = timezone.now() - timedelta(seconds=5)
    recent_estimates = (
        Estimate.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
            created_at__gte=window_start,
        )
        .prefetch_related("line_items")
        .order_by("-created_at")
    )
    for candidate in recent_estimates:
        if candidate.title != data.get("title", ""):
            continue
        if candidate.status != data.get("status", Estimate.Status.DRAFT):
            continue
        if candidate.valid_through != resolved_valid_through:
            continue
        candidate_terms_text = (candidate.terms_text or "").strip()
        incoming_terms_text = (organization.estimate_terms_and_conditions or "").strip()
        if candidate_terms_text != incoming_terms_text:
            continue
        if candidate.tax_percent != data.get("tax_percent", Decimal("0")):
            continue
        if _estimate_signature(candidate) == input_signature:
            return Response(
                {
                    "data": _serialize_estimate(estimate=candidate, actor_user_ids=actor_user_ids),
                    "meta": {"deduped": True},
                },
                status=200,
            )

    same_title_family = Estimate.objects.filter(
        project=project,
        created_by_id__in=actor_user_ids,
        title=data.get("title", ""),
    ).order_by("-version", "-id")
    approved_family_row = same_title_family.filter(status=Estimate.Status.APPROVED).first()
    if approved_family_row:
        return Response(
            {
                "error": {
                    "code": "estimate_family_approved_locked",
                    "message": "This estimate family already has an approved version and is locked. Use a new title or manage scope changes via change orders.",
                    "fields": {
                        "title": [
                            "Approved estimate families cannot create additional draft versions."
                        ]
                    },
                    "meta": {
                        "latest_estimate_id": approved_family_row.id,
                        "latest_version": approved_family_row.version,
                        "latest_status": approved_family_row.status,
                        "family_size": same_title_family.count(),
                    },
                }
            },
            status=409,
        )
    if same_title_family.exists() and not data.get("allow_existing_title_family", False):
        latest_family_row = same_title_family.first()
        return Response(
            {
                "error": {
                    "code": "estimate_family_exists",
                    "message": "An estimate family with this title already exists. Confirm to create a new version in that family.",
                    "fields": {
                        "title": [
                            "Use explicit confirmation before creating another version in an existing title family."
                        ]
                    },
                    "meta": {
                        "latest_estimate_id": latest_family_row.id if latest_family_row else None,
                        "latest_version": latest_family_row.version if latest_family_row else None,
                        "family_size": same_title_family.count(),
                    },
                }
            },
            status=409,
        )

    next_version = _next_estimate_family_version(
        project=project,
        user=request.user,
        title=data.get("title", ""),
    )
    terms_text = (organization.estimate_terms_and_conditions or "").strip()

    estimate = Estimate.objects.create(
        project=project,
        created_by=request.user,
        version=next_version,
        status=data.get("status", Estimate.Status.DRAFT),
        title=data.get("title", ""),
        valid_through=resolved_valid_through,
        terms_text=terms_text,
        tax_percent=data.get("tax_percent", Decimal("0")),
    )

    apply_error = _apply_estimate_lines_and_totals(
        estimate=estimate,
        line_items_data=line_items,
        tax_percent=data.get("tax_percent", Decimal("0")),
        user=request.user,
    )
    if apply_error:
        estimate.delete()
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more cost codes are invalid for this user.",
                    "fields": {"cost_code": apply_error["missing_cost_codes"]},
                }
            },
            status=400,
        )

    estimate.refresh_from_db()
    EstimateStatusEvent.record(
        estimate=estimate,
        from_status=None,
        to_status=estimate.status,
        note="Estimate created.",
        changed_by=request.user,
    )
    _archive_estimate_family(
        project=project,
        user=request.user,
        title=estimate.title,
        exclude_ids=[estimate.id],
        note=f"Archived because estimate #{estimate.id} superseded this version.",
    )
    return Response(
        {"data": _serialize_estimate(estimate=estimate, actor_user_ids=actor_user_ids)},
        status=201,
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def estimate_detail_view(request, estimate_id: int):
    """Fetch or patch one estimate with draft-locking and status-transition enforcement.

    Contract:
    - `GET`: returns estimate detail.
    - `PATCH`: requires role `owner|pm`; non-draft value edits are blocked.
    - Records immutable status events for workflow transitions.
    - Approved transitions trigger budget conversion guard path.
    """
    actor_user_ids = _organization_user_ids(request.user)
    try:
        estimate = Estimate.objects.get(id=estimate_id, created_by_id__in=actor_user_ids)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": _serialize_estimate(estimate=estimate, actor_user_ids=actor_user_ids)})

    permission_error, _ = _capability_gate(request.user, "estimates", "edit")
    if permission_error:
        return Response(permission_error, status=403)
    serializer = EstimateWriteSerializer(
        data=request.data,
        partial=True,
    )
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    # Status-transition capability gates
    if "status" in data:
        _next = data["status"]
        if _next in {Estimate.Status.SENT}:
            _err, _ = _capability_gate(request.user, "estimates", "send")
            if _err:
                return Response(_err, status=403)
        elif _next in {Estimate.Status.APPROVED, Estimate.Status.VOID}:
            _err, _ = _capability_gate(request.user, "estimates", "approve")
            if _err:
                return Response(_err, status=403)

    if "title" in data and data["title"] != estimate.title:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Estimate title cannot be changed after creation.",
                    "fields": {"title": ["Create a new estimate if the title needs to change."]},
                }
            },
            status=400,
        )
    if "terms_text" in data:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Estimate terms are managed by organization templates.",
                    "fields": {
                        "terms_text": [
                            "Set estimate terms in Organization settings; per-estimate overrides are disabled."
                        ]
                    },
                }
            },
            status=400,
        )
    is_locked = estimate.status != Estimate.Status.DRAFT
    mutating_fields = {"title", "valid_through", "tax_percent", "line_items"}
    if is_locked and any(field in data for field in mutating_fields):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Estimate values are locked after being sent.",
                    "fields": {
                        "title": ["Cannot edit non-draft estimate values."],
                        "valid_through": ["Cannot edit non-draft estimate values."],
                        "tax_percent": ["Cannot edit non-draft estimate values."],
                        "line_items": ["Cannot edit non-draft estimate values."],
                    },
                }
            },
            status=400,
        )
    status_note = (data.get("status_note", "") or "").strip()
    status_note_requested = status_note != ""
    status_changing = "status" in data
    next_status = data.get("status", estimate.status)
    is_sent_resend = (
        status_changing
        and estimate.status == Estimate.Status.SENT
        and next_status == Estimate.Status.SENT
    )
    same_status_note_request = status_changing and next_status == estimate.status and status_note_requested

    if status_changing and not (is_sent_resend or same_status_note_request) and not Estimate.is_transition_allowed(
        current_status=estimate.status,
        next_status=next_status,
    ):
        if estimate.status == Estimate.Status.DRAFT and next_status in {
            Estimate.Status.APPROVED,
            Estimate.Status.REJECTED,
        }:
            message = "Estimate must be sent before it can be approved or rejected."
        else:
            message = f"Invalid estimate status transition: {estimate.status} -> {next_status}."
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": message,
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    previous_status = estimate.status
    update_fields = ["updated_at"]
    if "title" in data:
        estimate.title = data["title"]
        update_fields.append("title")
    if "valid_through" in data:
        estimate.valid_through = data["valid_through"]
        update_fields.append("valid_through")
    if "status" in data:
        estimate.status = data["status"]
        update_fields.append("status")
    if "tax_percent" in data:
        estimate.tax_percent = data["tax_percent"]
        update_fields.append("tax_percent")
    estimate.save(update_fields=update_fields)

    if "line_items" in data:
        line_items = data["line_items"]
        if not line_items:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "At least one line item is required.",
                        "fields": {"line_items": ["At least one line item is required."]},
                    }
                },
                status=400,
            )
        apply_error = _apply_estimate_lines_and_totals(
            estimate=estimate,
            line_items_data=line_items,
            tax_percent=data.get("tax_percent", estimate.tax_percent),
            user=request.user,
        )
        if apply_error:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "One or more cost codes are invalid for this user.",
                        "fields": {"cost_code": apply_error["missing_cost_codes"]},
                    }
                },
                status=400,
            )
    elif "tax_percent" in data:
        # Recalculate totals with existing lines when tax is updated.
        existing_lines = [
            {
                "cost_code": line.cost_code_id,
                "description": line.description,
                "quantity": line.quantity,
                "unit": line.unit,
                "unit_cost": line.unit_cost,
                "markup_percent": line.markup_percent,
            }
            for line in estimate.line_items.all()
        ]
        _apply_estimate_lines_and_totals(
            estimate=estimate,
            line_items_data=existing_lines,
            tax_percent=estimate.tax_percent,
            user=request.user,
        )

    should_record_status_event = status_changing and (
        previous_status != estimate.status
        or (previous_status == Estimate.Status.SENT and estimate.status == Estimate.Status.SENT)
    )
    should_record_status_event = (
        should_record_status_event
        or (
            previous_status == estimate.status
            and status_note_requested
        )
    )
    budget_conversion_meta = {}
    if should_record_status_event:
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=previous_status,
            to_status=estimate.status,
            note=status_note,
            changed_by=request.user,
        )
        if estimate.status == Estimate.Status.SENT:
            customer_email = (estimate.project.customer.email or "").strip()
            if customer_email:
                send_document_sent_email(
                    document_type="Estimate",
                    document_title=f"{estimate.title} (v{estimate.version})",
                    public_url=f"{settings.FRONTEND_URL}/estimate/{estimate.public_ref}",
                    recipient_email=customer_email,
                    sender_user=request.user,
                )
        if estimate.status == Estimate.Status.APPROVED:
            _activate_project_from_estimate_approval(
                estimate=estimate,
                actor=request.user,
                note=f"Project moved to active after approval of estimate #{estimate.id}.",
            )
            budget_row, conversion_status = _ensure_budget_from_approved_estimate(
                estimate=estimate,
                user=request.user,
                note=f"Budget auto-converted from approved estimate #{estimate.id}.",
                allow_supersede=True,
            )
            budget_conversion_meta["budget_conversion_status"] = conversion_status

    estimate.refresh_from_db()
    response_payload = {"data": _serialize_estimate(estimate=estimate, actor_user_ids=actor_user_ids)}
    if budget_conversion_meta:
        response_payload["meta"] = budget_conversion_meta
    return Response(response_payload)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def estimate_clone_version_view(request, estimate_id: int):
    """Create a new draft revision from a prior estimate version in the same title family."""
    actor_user_ids = _organization_user_ids(request.user)
    try:
        estimate = Estimate.objects.prefetch_related("line_items").get(
            id=estimate_id,
            created_by_id__in=actor_user_ids,
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _capability_gate(request.user, "estimates", "create")
    if permission_error:
        return Response(permission_error, status=403)

    if estimate.status not in {
        Estimate.Status.SENT,
        Estimate.Status.REJECTED,
        Estimate.Status.VOID,
        Estimate.Status.ARCHIVED,
    }:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Revisions can only be created from sent, rejected, voided, or archived estimates. Draft estimates can be edited directly in the estimate viewer.",
                    "fields": {
                        "status": [
                            "Only sent, rejected, voided, or archived estimates can create revisions. Edit draft estimates directly."
                        ]
                    },
                }
            },
            status=400,
        )

    next_version = _next_estimate_family_version(
        project=estimate.project,
        user=request.user,
        title=estimate.title,
    )

    cloned = Estimate.objects.create(
        project=estimate.project,
        created_by=request.user,
        version=next_version,
        status=Estimate.Status.DRAFT,
        title=estimate.title,
        valid_through=estimate.valid_through,
        terms_text=estimate.terms_text,
        tax_percent=estimate.tax_percent,
    )

    line_items = [
        {
            "cost_code": line.cost_code_id,
            "description": line.description,
            "quantity": line.quantity,
            "unit": line.unit,
            "unit_cost": line.unit_cost,
            "markup_percent": line.markup_percent,
        }
        for line in estimate.line_items.all()
    ]
    if line_items:
        _apply_estimate_lines_and_totals(
            estimate=cloned,
            line_items_data=line_items,
            tax_percent=estimate.tax_percent,
            user=request.user,
        )

    cloned.refresh_from_db()
    EstimateStatusEvent.record(
        estimate=cloned,
        from_status=None,
        to_status=cloned.status,
        note=f"Cloned from estimate #{estimate.id}.",
        changed_by=request.user,
    )
    if estimate.status == Estimate.Status.SENT:
        estimate.status = Estimate.Status.REJECTED
        estimate.save(update_fields=["status", "updated_at"])
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=Estimate.Status.SENT,
            to_status=Estimate.Status.REJECTED,
            note=f"Auto-rejected because revision #{cloned.id} was created.",
            changed_by=request.user,
        )
    return Response(
        {
            "data": _serialize_estimate(estimate=cloned, actor_user_ids=actor_user_ids),
            "meta": {"cloned_from": estimate.id},
        },
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def estimate_duplicate_view(request, estimate_id: int):
    """Duplicate an estimate into a draft for same or another project/title context."""
    actor_user_ids = _organization_user_ids(request.user)
    try:
        estimate = Estimate.objects.prefetch_related("line_items").get(
            id=estimate_id,
            created_by_id__in=actor_user_ids,
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _capability_gate(request.user, "estimates", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = EstimateDuplicateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    target_project = estimate.project
    target_project_id = data.get("project_id")
    if target_project_id:
        target_project = _validate_project_for_user(target_project_id, request.user)
        if not target_project:
            return Response(
                {
                    "error": {
                        "code": "not_found",
                        "message": "Target project not found.",
                        "fields": {"project_id": ["Project not found."]},
                    }
                },
                status=404,
            )

    target_title = data["title"]
    if target_project.id == estimate.project.id and target_title == estimate.title:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Use clone version for same-project same-title revisions.",
                    "fields": {
                        "title": [
                            "Provide a different title or choose another project when duplicating."
                        ]
                    },
                }
            },
            status=400,
        )

    next_version = _next_estimate_family_version(
        project=target_project,
        user=request.user,
        title=target_title,
    )

    duplicated = Estimate.objects.create(
        project=target_project,
        created_by=request.user,
        version=next_version,
        status=Estimate.Status.DRAFT,
        title=target_title,
        valid_through=estimate.valid_through,
        terms_text=estimate.terms_text,
        tax_percent=estimate.tax_percent,
    )

    line_items = [
        {
            "cost_code": line.cost_code_id,
            "description": line.description,
            "quantity": line.quantity,
            "unit": line.unit,
            "unit_cost": line.unit_cost,
            "markup_percent": line.markup_percent,
        }
        for line in estimate.line_items.all()
    ]
    if line_items:
        _apply_estimate_lines_and_totals(
            estimate=duplicated,
            line_items_data=line_items,
            tax_percent=estimate.tax_percent,
            user=request.user,
        )

    duplicated.refresh_from_db()
    EstimateStatusEvent.record(
        estimate=duplicated,
        from_status=None,
        to_status=duplicated.status,
        note=f"Duplicated from estimate #{estimate.id}.",
        changed_by=request.user,
    )
    return Response(
        {
            "data": _serialize_estimate(estimate=duplicated, actor_user_ids=actor_user_ids),
            "meta": {"duplicated_from": estimate.id},
        },
        status=201,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def estimate_status_events_view(request, estimate_id: int):
    """Return immutable estimate status transition history."""
    actor_user_ids = _organization_user_ids(request.user)
    try:
        estimate = Estimate.objects.get(id=estimate_id, created_by_id__in=actor_user_ids)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    events = EstimateStatusEvent.objects.filter(estimate=estimate).select_related(
        "changed_by",
        "estimate__project__customer",
    )
    return Response({"data": EstimateStatusEventSerializer(events, many=True).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def estimate_convert_to_budget_view(request, estimate_id: int):
    """Convert an approved estimate to a budget (idempotent if already converted)."""
    actor_user_ids = _organization_user_ids(request.user)
    try:
        estimate = (
            Estimate.objects.select_related("project")
            .prefetch_related("line_items", "line_items__cost_code")
            .get(id=estimate_id, created_by_id__in=actor_user_ids)
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    supersede_active = _parse_request_bool(
        request.data.get("supersede_active", False),
        default=False,
    )
    permission_error, capabilities = _capability_gate(request.user, "estimates", "approve")
    if permission_error:
        return Response(permission_error, status=403)
    if supersede_active and "edit" not in capabilities.get("org_identity", []):
        return Response(
            {
                "error": {
                    "code": "forbidden",
                    "message": "Only owners can supersede an active financial baseline.",
                    "fields": {
                        "capability": [
                            "org_identity.edit is required when supersede_active=true."
                        ]
                    },
                }
            },
            status=403,
        )

    if estimate.status != Estimate.Status.APPROVED:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Only approved estimates can be converted to budgets.",
                    "fields": {
                        "status": ["Estimate status must be approved before conversion."]
                    },
                }
            },
            status=400,
        )

    budget, conversion_status = _ensure_budget_from_approved_estimate(
        estimate=estimate,
        user=request.user,
        note=f"Budget converted from estimate #{estimate.id}.",
        allow_supersede=supersede_active,
    )
    if conversion_status == "requires_supersede":
        active_financial_estimate_id = budget.source_estimate_id if budget else None
        return Response(
            {
                "error": {
                    "code": "conflict",
                    "message": "An active financial baseline already exists for this project.",
                    "fields": {
                        "supersede_active": [
                            "Set supersede_active=true to explicitly activate this estimate for financials."
                        ],
                    },
                    "meta": {
                        "active_financial_estimate_id": active_financial_estimate_id,
                    },
                }
            },
            status=409,
        )
    return Response(
        {"data": BudgetSerializer(budget).data, "meta": {"conversion_status": conversion_status}},
        status=201 if conversion_status in {"converted", "superseded_and_converted"} else 200,
    )
