"""Estimate authoring and public sharing endpoints."""

import logging

from datetime import timedelta
from decimal import Decimal

logger = logging.getLogger(__name__)

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import Estimate, EstimateStatusEvent, SigningCeremonyRecord
from core.policies import get_estimate_policy_contract
from core.serializers import (
    EstimateSerializer,
    EstimateStatusEventSerializer,
    EstimateWriteSerializer,
)
from django_q.tasks import async_task
from core.utils.request import get_client_ip
from core.utils.signing import compute_document_content_hash
from core.views.estimating.estimates_helpers import (
    ESTIMATE_DECISION_TO_STATUS,
    _apply_estimate_lines_and_totals,
    _archive_estimate_family,
    _estimate_stored_signature,
    _handle_estimate_document_save,
    _handle_estimate_status_note,
    _handle_estimate_status_transition,
    _line_items_signature,
    _next_estimate_family_version,
    _prefetch_estimate_qs,
)
from core.views.helpers import (
    _build_public_decision_note,
    _capability_gate,
    _check_project_accepts_document,
    _ensure_org_membership,
    _promote_prospect_to_active,
    _resolve_organization_for_public_actor,
    _serialize_public_organization_context,
    _serialize_public_project_context,
    _validate_estimate_for_user,
    _validate_project_for_user,
)
from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision


@api_view(["GET"])
@permission_classes([AllowAny])
def public_estimate_detail_view(request, public_token):
    """Return public estimate detail for customer share links.

    Loads the estimate by public token with project, customer, and line-item
    relations.  Enriches the response with lightweight project context,
    organization context, and signing ceremony consent text.

    Flow:
        1. Look up estimate by public token.
        2. Reject draft documents (not yet sent to customer).
        3. Resolve organization from the estimate creator.
        4. Attach project context, org context, and ceremony consent.

    URL: ``GET /api/v1/public/estimate/<public_token>/detail/``

    Request body: (none)

    Success 200::

        { "data": { ..., "project_context": {...}, "organization_context": {...} } }

    Errors:
        - 404: Estimate not found or still in draft status.
    """
    try:
        estimate = _prefetch_estimate_qs(Estimate.objects.all()).get(public_token=public_token)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    if estimate.status == Estimate.Status.DRAFT:
        return Response(
            {"error": {"code": "not_available", "message": "This estimate is not yet available.", "fields": {}}},
            status=404,
        )

    estimate_data = EstimateSerializer(estimate).data
    organization = _resolve_organization_for_public_actor(estimate.created_by)
    estimate_data["project_context"] = _serialize_public_project_context(estimate.project)
    estimate_data["organization_context"] = _serialize_public_organization_context(organization, request=request)
    consent_text, consent_version = get_ceremony_context()
    estimate_data["ceremony_consent_text"] = consent_text
    estimate_data["ceremony_consent_text_version"] = consent_version
    return Response({"data": estimate_data})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_estimate_decision_view(request, public_token):
    """Apply a customer approve/reject decision through a public estimate link.

    Validates the decision value, confirms the estimate is in ``sent``
    status, runs signing ceremony verification, then atomically transitions
    the estimate, records audit events, and creates a signing ceremony
    record.  On approval, also activates the parent project if eligible.

    Flow:
        1. Look up estimate by public token.
        2. Validate decision (approve/reject) and current status (must be sent).
        3. Validate signing ceremony (OTP session).
        4. Transition estimate status + record audit event (atomic).
        5. On approval, activate project if prospect/on-hold.
        6. Record signing ceremony with content hash.

    URL: ``POST /api/v1/public/estimate/<public_token>/decision/``

    Request body::

        { "decision": "approve", "note": "Looks good" }

    Success 200::

        { "data": { ..., "project_context": {...}, "organization_context": {...} } }

    Errors:
        - 400: Invalid decision value.
        - 404: Estimate not found.
        - 409: Estimate not in ``sent`` status.
    """
    try:
        estimate = _prefetch_estimate_qs(Estimate.objects.all()).get(public_token=public_token)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    decision = str(request.data.get("decision", "")).strip().lower()
    next_status = ESTIMATE_DECISION_TO_STATUS.get(decision)
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
    consent_text, consent_version = get_ceremony_context()
    with transaction.atomic():
        estimate.status = next_status
        estimate.save(update_fields=["status", "updated_at"])
        client_ip = get_client_ip(request)
        user_agent = request.META.get("HTTP_USER_AGENT", "")
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=previous_status,
            to_status=estimate.status,
            note=decision_note,
            changed_by=estimate.created_by,
            ip_address=client_ip,
            user_agent=user_agent,
        )
        if estimate.status == Estimate.Status.APPROVED:
            _promote_prospect_to_active(estimate.project)

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
            ip_address=client_ip,
            user_agent=user_agent,
            consent_text_version=consent_version,
            consent_text_snapshot=consent_text,
            note=str(request.data.get("note", "") or "").strip(),
            access_session=ceremony_session,
        )

    logger.info("Estimate public decision: id=%s title='%s' v%s decision=%s from=%s", estimate.id, estimate.title, estimate.version, decision, client_ip)

    # Queue push + email notification to document owner (non-blocking).
    async_task(
        "core.tasks.send_document_decision_notification",
        estimate.created_by_id,
        "estimate",
        estimate.title,
        estimate.project.customer.display_name,
        decision,
        f"/projects/{estimate.project_id}/estimates",
    )

    estimate_data = EstimateSerializer(estimate).data
    organization = _resolve_organization_for_public_actor(estimate.created_by)
    estimate_data["project_context"] = _serialize_public_project_context(estimate.project)
    estimate_data["organization_context"] = _serialize_public_organization_context(organization, request=request)

    return Response({"data": estimate_data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def estimate_contract_view(_request):
    """Return the canonical estimate workflow policy contract.

    Read-only endpoint that returns status definitions, allowed transitions,
    and role requirements.  Used by the frontend to gate UI elements without
    hard-coding business rules.

    Flow:
        1. Return the estimate policy contract payload.

    URL: ``GET /api/v1/estimates/contract/``

    Request body: (none)

    Success 200::

        { "data": { "statuses": [...], "transitions": [...] } }
    """
    return Response({"data": get_estimate_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_estimates_view(request, project_id):
    """List project estimates or create a new estimate version.

    GET returns all estimates for the project with line items and cost
    codes.  POST creates a new estimate within a title family, enforcing
    duplicate-submit suppression (5-second window), approved-family
    locking, and same-title-family confirmation.  Archives superseded
    family members after creation.

    Flow (GET):
        1. Validate project scope.
        2. Return all estimates with prefetched line items.

    Flow (POST):
        1. Capability gate: ``estimates.create``.
        1b. Reject if project is cancelled or completed (terminal guard).
        2. Validate fields, resolve ``valid_through`` default from org settings.
        3. Reject terms_text override and empty line items.
        4. Check duplicate-submit suppression window.
        5. Check approved-family lock and same-title-family confirmation.
        6. Create estimate, apply line items, record audit event (atomic).
        7. Archive superseded family members.

    URL: ``GET/POST /api/v1/projects/<project_id>/estimates/``

    Request body (POST)::

        { "title": "Phase 1", "line_items": [...], "tax_percent": "8.25" }

    Success 200 (GET)::

        { "data": [{ ... }, ...] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Validation error (empty lines, terms override, locked family, etc.).
        - 403: Missing ``estimates.create`` capability.
        - 404: Project not found.
        - 409: Approved family locked or unconfirmed title family exists.
    """
    membership = _ensure_org_membership(request.user)
    organization = membership.organization
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        estimates = _prefetch_estimate_qs(
            Estimate.objects.filter(project=project)
        ).order_by("-version")
        return Response({"data": EstimateSerializer(estimates, many=True).data})

    elif request.method == "POST":
        permission_error, _ = _capability_gate(request.user, "estimates", "create")
        if permission_error:
            return Response(permission_error, status=403)

        terminal_error = _check_project_accepts_document(project, "estimates")
        if terminal_error:
            return terminal_error

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

        input_signature = _line_items_signature(line_items)
        window_start = timezone.now() - timedelta(seconds=5)
        recent_estimates = (
            Estimate.objects.filter(
                project=project,
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
            if _estimate_stored_signature(candidate) == input_signature:
                return Response(
                    {
                        "data": EstimateSerializer(candidate).data,
                        "meta": {"deduped": True},
                    },
                    status=200,
                )

        same_title_family = Estimate.objects.filter(
            project=project,
            title=data.get("title", ""),
        ).order_by("-version", "-id")
        approved_estimate = same_title_family.filter(status=Estimate.Status.APPROVED).first()
        if approved_estimate:
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
                            "latest_estimate_id": approved_estimate.id,
                            "latest_version": approved_estimate.version,
                            "latest_status": approved_estimate.status,
                            "family_size": same_title_family.count(),
                        },
                    }
                },
                status=409,
            )
        if same_title_family.exists() and not data.get("allow_existing_title_family", False):
            latest_estimate = same_title_family.first()
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
                            "latest_estimate_id": latest_estimate.id if latest_estimate else None,
                            "latest_version": latest_estimate.version if latest_estimate else None,
                            "family_size": same_title_family.count(),
                        },
                    }
                },
                status=409,
            )

        next_version = _next_estimate_family_version(
            project=project,
            title=data.get("title", ""),
        )
        terms_text = (organization.estimate_terms_and_conditions or "").strip()
        sender_logo_url = ""
        if organization.logo:
            sender_logo_url = request.build_absolute_uri(organization.logo.url)

        with transaction.atomic():
            estimate = Estimate.objects.create(
                project=project,
                created_by=request.user,
                version=next_version,
                status=data.get("status", Estimate.Status.DRAFT),
                title=data.get("title", ""),
                valid_through=resolved_valid_through,
                terms_text=terms_text,
                sender_name=(organization.display_name or "").strip(),
                sender_address=organization.formatted_billing_address,
                sender_logo_url=sender_logo_url,
                tax_percent=data.get("tax_percent", Decimal("0")),
            )

            if apply_error := _apply_estimate_lines_and_totals(
                estimate=estimate,
                line_items_data=line_items,
                tax_percent=data.get("tax_percent", Decimal("0")),
                user=request.user,
            ):
                transaction.set_rollback(True)
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
            {"data": EstimateSerializer(estimate).data},
            status=201,
        )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def estimate_detail_view(request, estimate_id):
    """Fetch or update a single estimate with draft-locking enforcement.

    GET returns the estimate detail.  PATCH supports three concern paths:
    status transitions (with capability gates per target status), status
    notes (audit-only, no transition), and document saves (field + line-item
    updates).  Non-draft estimates are locked against value edits.

    Flow (GET):
        1. Look up estimate scoped to user's org.
        2. Return serialized estimate.

    Flow (PATCH):
        1. Capability gate: ``estimates.edit``.
        2. Additional capability gates for send (``estimates.send``) and
           approve/void (``estimates.approve``) transitions.
        3. Reject immutable-field edits (title, terms_text).
        4. Reject value edits on non-draft estimates (locked).
        5. Dispatch to status-transition, status-note, or document-save handler.

    URL: ``GET/PATCH /api/v1/estimates/<estimate_id>/``

    Request body (PATCH)::

        { "status": "sent", "status_note": "Sending to client" }

    Success 200::

        { "data": { ... }, "email_sent": false }

    Errors:
        - 400: Immutable field, locked estimate, invalid transition.
        - 403: Missing capability for the requested action.
        - 404: Estimate not found.
    """
    estimate = _validate_estimate_for_user(estimate_id, request.user)
    if not estimate:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": EstimateSerializer(estimate).data})

    elif request.method == "PATCH":
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
            requested_status = data["status"]
            if requested_status in {Estimate.Status.SENT}:
                permission_error, _ = _capability_gate(request.user, "estimates", "send")
                if permission_error:
                    return Response(permission_error, status=403)
            elif requested_status in {Estimate.Status.APPROVED, Estimate.Status.VOID}:
                permission_error, _ = _capability_gate(request.user, "estimates", "approve")
                if permission_error:
                    return Response(permission_error, status=403)

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
        # --- Concern dispatch ---
        previous_status = estimate.status
        next_status = data.get("status", estimate.status)
        status_changing = "status" in data
        is_actual_transition = status_changing and previous_status != next_status
        is_resend = (
            status_changing
            and previous_status == Estimate.Status.SENT
            and next_status == Estimate.Status.SENT
        )
        status_note = (data.get("status_note", "") or "").strip()

        if is_actual_transition or is_resend:
            return _handle_estimate_status_transition(
                request, estimate, data,
                previous_status, next_status, is_resend,
            )
        if status_note:
            return _handle_estimate_status_note(request, estimate, data)
        return _handle_estimate_document_save(request, estimate, data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def estimate_status_events_view(request, estimate_id):
    """Return the immutable status-transition audit trail for an estimate.

    Flow:
        1. Look up estimate scoped to user's org.
        2. Query all status events with related user and project data.

    URL: ``GET /api/v1/estimates/<estimate_id>/status-events/``

    Request body: (none)

    Success 200::

        { "data": [{ "from_status": "draft", "to_status": "sent", ... }, ...] }

    Errors:
        - 404: Estimate not found.
    """
    estimate = _validate_estimate_for_user(estimate_id, request.user)
    if not estimate:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    status_events = EstimateStatusEvent.objects.filter(estimate=estimate).select_related(
        "changed_by",
        "estimate__project__customer",
    )
    return Response({"data": EstimateStatusEventSerializer(status_events, many=True).data})
