"""Quote authoring and public sharing endpoints."""

import logging

from datetime import timedelta
from decimal import Decimal

logger = logging.getLogger(__name__)

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import BillingPeriod, Quote, QuoteStatusEvent, SigningCeremonyRecord
from core.policies import get_quote_policy_contract
from core.serializers import (
    QuoteSerializer,
    QuoteStatusEventSerializer,
    QuoteWriteSerializer,
)
from django_q.tasks import async_task
from core.utils.request import get_client_ip
from core.utils.signing import compute_document_content_hash
from core.views.quoting.quotes_helpers import (
    CONTRACT_PDF_ALLOWED_CONTENT_TYPES,
    CONTRACT_PDF_MAX_SIZE_BYTES,
    QUOTE_DECISION_TO_STATUS,
    _apply_quote_lines_and_totals,
    _archive_quote_family,
    _quote_stored_signature,
    _format_serializer_errors,
    _handle_quote_document_save,
    _handle_quote_status_note,
    _handle_quote_status_transition,
    _line_items_signature,
    _next_quote_family_version,
    _prefetch_quote_qs,
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
    _validate_quote_for_user,
    _validate_project_for_user,
)
from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision


@api_view(["GET"])
@permission_classes([AllowAny])
def public_quote_detail_view(request, public_token):
    """Return public quote detail for customer share links.

    Loads the quote by public token with project, customer, and line-item
    relations.  Enriches the response with lightweight project context,
    organization context, and signing ceremony consent text.

    Flow:
        1. Look up quote by public token.
        2. Reject draft documents (not yet sent to customer).
        3. Resolve organization from the quote creator.
        4. Attach project context, org context, and ceremony consent.

    URL: ``GET /api/v1/public/quote/<public_token>/detail/``

    Request body: (none)

    Success 200::

        { "data": { ..., "project_context": {...}, "organization_context": {...} } }

    Errors:
        - 404: Quote not found or still in draft status.
    """
    try:
        quote = _prefetch_quote_qs(Quote.objects.all()).get(public_token=public_token)
    except Quote.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Quote not found.", "fields": {}}},
            status=404,
        )

    if quote.status == Quote.Status.DRAFT:
        return Response(
            {"error": {"code": "not_available", "message": "This quote is not yet available.", "fields": {}}},
            status=404,
        )

    quote_data = QuoteSerializer(quote).data
    organization = _resolve_organization_for_public_actor(quote.created_by)
    quote_data["project_context"] = _serialize_public_project_context(quote.project)
    quote_data["organization_context"] = _serialize_public_organization_context(organization, request=request)
    consent_text, consent_version = get_ceremony_context()
    quote_data["ceremony_consent_text"] = consent_text
    quote_data["ceremony_consent_text_version"] = consent_version
    return Response({"data": quote_data})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_quote_decision_view(request, public_token):
    """Apply a customer approve/reject decision through a public quote link.

    Validates the decision value, confirms the quote is in ``sent``
    status, runs signing ceremony verification, then atomically transitions
    the quote, records audit events, and creates a signing ceremony
    record.  On approval, also activates the parent project if eligible.

    Flow:
        1. Look up quote by public token.
        2. Validate decision (approve/reject) and current status (must be sent).
        3. Validate signing ceremony (OTP session).
        4. Transition quote status + record audit event (atomic).
        5. On approval, activate project if prospect/on-hold.
        6. Record signing ceremony with content hash.

    URL: ``POST /api/v1/public/quote/<public_token>/decision/``

    Request body::

        { "decision": "approve", "note": "Looks good" }

    Success 200::

        { "data": { ..., "project_context": {...}, "organization_context": {...} } }

    Errors:
        - 400: Invalid decision value.
        - 404: Quote not found.
        - 409: Quote not in ``sent`` status.
    """
    try:
        quote = _prefetch_quote_qs(Quote.objects.all()).get(public_token=public_token)
    except Quote.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Quote not found.", "fields": {}}},
            status=404,
        )

    decision = str(request.data.get("decision", "")).strip().lower()
    next_status = QUOTE_DECISION_TO_STATUS.get(decision)
    if not next_status:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid public decision for quote.",
                    "fields": {"decision": ["Use 'approve' or 'reject'."]},
                }
            },
            status=400,
        )

    if quote.status != Quote.Status.SENT:
        return Response(
            {
                "error": {
                    "code": "conflict",
                    "message": "This quote is not awaiting customer approval.",
                    "fields": {"status": [f"Current status is '{quote.status}'."]},
                }
            },
            status=409,
        )

    # --- Ceremony validation ---
    customer_email = (quote.project.customer.email or "").strip()
    ceremony_session, signer_name, ceremony_error = validate_ceremony_on_decision(
        request, public_token, customer_email,
    )
    if ceremony_error:
        return ceremony_error

    decision_note = _build_public_decision_note(
        action_label="Approved" if next_status == Quote.Status.APPROVED else "Rejected",
        note=str(request.data.get("note", "") or ""),
        decider_name=signer_name,
        decider_email=ceremony_session.recipient_email if ceremony_session else "",
    )

    previous_status = quote.status
    consent_text, consent_version = get_ceremony_context()
    with transaction.atomic():
        quote.status = next_status
        quote.save(update_fields=["status", "updated_at"])
        client_ip = get_client_ip(request)
        user_agent = request.META.get("HTTP_USER_AGENT", "")
        QuoteStatusEvent.record(
            quote=quote,
            from_status=previous_status,
            to_status=quote.status,
            note=decision_note,
            changed_by=quote.created_by,
            ip_address=client_ip,
            user_agent=user_agent,
        )
        if quote.status == Quote.Status.APPROVED:
            _promote_prospect_to_active(quote.project)

        content_hash = compute_document_content_hash("quote", QuoteSerializer(quote).data)
        SigningCeremonyRecord.record(
            document_type="quote",
            document_id=quote.id,
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

    logger.info("Quote public decision: id=%s title='%s' v%s decision=%s from=%s", quote.id, quote.title, quote.version, decision, client_ip)

    # Queue push + email notification to document owner (non-blocking).
    async_task(
        "core.tasks.send_document_decision_notification",
        quote.created_by_id,
        "quote",
        quote.title,
        quote.project.customer.display_name,
        decision,
        f"/projects/{quote.project_id}/quotes",
    )

    quote_data = QuoteSerializer(quote).data
    organization = _resolve_organization_for_public_actor(quote.created_by)
    quote_data["project_context"] = _serialize_public_project_context(quote.project)
    quote_data["organization_context"] = _serialize_public_organization_context(organization, request=request)

    return Response({"data": quote_data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def quote_contract_view(_request):
    """Return the canonical quote workflow policy contract.

    Read-only endpoint that returns status definitions, allowed transitions,
    and role requirements.  Used by the frontend to gate UI elements without
    hard-coding business rules.

    Flow:
        1. Return the quote policy contract payload.

    URL: ``GET /api/v1/quotes/contract/``

    Request body: (none)

    Success 200::

        { "data": { "statuses": [...], "transitions": [...] } }
    """
    return Response({"data": get_quote_policy_contract()})


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
def quote_contract_pdf_upload_view(request, quote_id):
    """Upload, replace, or delete the contract PDF attached to an quote.

    POST accepts ``multipart/form-data`` with a single ``contract_pdf`` file
    field.  Validates content type (PDF only) and size (10 MB max).  If a
    previous file exists it is deleted before saving the new one.

    DELETE removes the attached contract PDF if one exists.

    Flow:
        1. Capability gate: ``quotes.edit``.
        2. Validate quote is in the user's org.
        3. (POST) Validate file presence, content type, and size.
        4. Delete previous file if one exists.
        5. Save new file (POST) or clear field (DELETE).

    URL: ``POST/DELETE /api/v1/quotes/<quote_id>/contract-pdf/``

    Request body (POST): ``multipart/form-data`` with ``contract_pdf`` file field.

    Success 200::

        { "data": { ... } }

    Errors:
        - 400: No file provided, unsupported content type, or file too large.
        - 403: Missing ``quotes.edit`` capability.
        - 404: Quote not found.
    """
    permission_error, _ = _capability_gate(request.user, "quotes", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    quote = _validate_quote_for_user(quote_id, request.user)
    if not quote:
        return Response(
            {"error": {"code": "not_found", "message": "Quote not found.", "fields": {}}},
            status=404,
        )

    previous_url = request.build_absolute_uri(quote.contract_pdf.url) if quote.contract_pdf else ""

    if request.method == "DELETE":
        if quote.contract_pdf:
            quote.contract_pdf = ""
            quote.save(update_fields=["contract_pdf", "updated_at"])
            QuoteStatusEvent.record(
                quote=quote,
                from_status=quote.status,
                to_status=quote.status,
                note=f"Contract PDF removed (previous: {previous_url}).",
                changed_by=request.user,
            )
        return Response({"data": QuoteSerializer(quote, context={"request": request}).data})

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

    quote.contract_pdf = pdf_file
    quote.save(update_fields=["contract_pdf", "updated_at"])

    if previous_url:
        note = f"Contract PDF replaced: {pdf_file.name} (previous: {previous_url})."
    else:
        note = f"Contract PDF attached: {pdf_file.name}."
    QuoteStatusEvent.record(
        quote=quote,
        from_status=quote.status,
        to_status=quote.status,
        note=note,
        changed_by=request.user,
    )

    return Response({"data": QuoteSerializer(quote, context={"request": request}).data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_quotes_view(request, project_id):
    """List project quotes or create a new quote version.

    GET returns all quotes for the project with line items and cost
    codes.  POST creates a new quote within a title family, enforcing
    duplicate-submit suppression (5-second window), approved-family
    locking, and same-title-family confirmation.  Archives superseded
    family members after creation.

    Flow (GET):
        1. Validate project scope.
        2. Return all quotes with prefetched line items.

    Flow (POST):
        1. Capability gate: ``quotes.create``.
        1b. Reject if project is cancelled or completed (terminal guard).
        2. Validate fields, resolve ``valid_through`` default from org settings.
        3. Reject terms_text override and empty line items.
        4. Check duplicate-submit suppression window.
        5. Check approved-family lock and same-title-family confirmation.
        6. Create quote, apply line items, record audit event (atomic).
        7. Archive superseded family members.

    URL: ``GET/POST /api/v1/projects/<project_id>/quotes/``

    Request body (POST)::

        { "title": "Phase 1", "line_items": [...], "tax_percent": "8.25" }

    Success 200 (GET)::

        { "data": [{ ... }, ...] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Validation error (empty lines, terms override, locked family, etc.).
        - 403: Missing ``quotes.create`` capability.
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
        quotes = _prefetch_quote_qs(
            Quote.objects.filter(project=project)
        ).order_by("-version")
        return Response({"data": QuoteSerializer(quotes, many=True, context={"request": request}).data})

    elif request.method == "POST":
        permission_error, _ = _capability_gate(request.user, "quotes", "create")
        if permission_error:
            return Response(permission_error, status=403)

        terminal_error = _check_project_accepts_document(project, "quotes")
        if terminal_error:
            return terminal_error

        serializer = QuoteWriteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": _format_serializer_errors(serializer.errors),
                        "fields": serializer.errors,
                    }
                },
                status=400,
            )
        data = serializer.validated_data
        resolved_valid_through = data.get("valid_through")
        if resolved_valid_through is None:
            validation_delta_days = max(
                1,
                min(365, int(organization.default_quote_valid_delta or 30)),
            )
            resolved_valid_through = timezone.localdate() + timedelta(days=validation_delta_days)
        if "terms_text" in data:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Quote terms are managed by organization templates.",
                        "fields": {
                            "terms_text": [
                                "Set quote terms in Organization settings; per-quote overrides are disabled."
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
        recent_quotes = (
            Quote.objects.filter(
                project=project,
                created_at__gte=window_start,
            )
            .prefetch_related("line_items")
            .order_by("-created_at")
        )
        for candidate in recent_quotes:
            if candidate.title != data.get("title", ""):
                continue
            if candidate.status != data.get("status", Quote.Status.DRAFT):
                continue
            if candidate.valid_through != resolved_valid_through:
                continue
            candidate_terms_text = (candidate.terms_text or "").strip()
            incoming_terms_text = (organization.quote_terms_and_conditions or "").strip()
            if candidate_terms_text != incoming_terms_text:
                continue
            if candidate.tax_percent != data.get("tax_percent", Decimal("0")):
                continue
            if _quote_stored_signature(candidate) == input_signature:
                return Response(
                    {
                        "data": QuoteSerializer(candidate).data,
                        "meta": {"deduped": True},
                    },
                    status=200,
                )

        same_title_family = Quote.objects.filter(
            project=project,
            title=data.get("title", ""),
        ).order_by("-version", "-id")
        approved_quote = same_title_family.filter(status=Quote.Status.APPROVED).first()
        if approved_quote:
            return Response(
                {
                    "error": {
                        "code": "quote_family_approved_locked",
                        "message": "This quote family already has an approved version and is locked. Use a new title or manage scope changes via change orders.",
                        "fields": {
                            "title": [
                                "Approved quote families cannot create additional draft versions."
                            ]
                        },
                        "meta": {
                            "latest_quote_id": approved_quote.id,
                            "latest_version": approved_quote.version,
                            "latest_status": approved_quote.status,
                            "family_size": same_title_family.count(),
                        },
                    }
                },
                status=409,
            )
        if same_title_family.exists() and not data.get("allow_existing_title_family", False):
            latest_quote = same_title_family.first()
            return Response(
                {
                    "error": {
                        "code": "quote_family_exists",
                        "message": "An quote family with this title already exists. Confirm to create a new version in that family.",
                        "fields": {
                            "title": [
                                "Use explicit confirmation before creating another version in an existing title family."
                            ]
                        },
                        "meta": {
                            "latest_quote_id": latest_quote.id if latest_quote else None,
                            "latest_version": latest_quote.version if latest_quote else None,
                            "family_size": same_title_family.count(),
                        },
                    }
                },
                status=409,
            )

        next_version = _next_quote_family_version(
            project=project,
            title=data.get("title", ""),
        )
        terms_text = (organization.quote_terms_and_conditions or "").strip()
        sender_logo_url = ""
        if organization.logo:
            sender_logo_url = request.build_absolute_uri(organization.logo.url)

        with transaction.atomic():
            quote = Quote.objects.create(
                project=project,
                created_by=request.user,
                version=next_version,
                status=data.get("status", Quote.Status.DRAFT),
                title=data.get("title", ""),
                valid_through=resolved_valid_through,
                terms_text=terms_text,
                notes_text=(data.get("notes_text", "") or "").strip(),
                sender_name=(organization.display_name or "").strip(),
                sender_address=organization.formatted_billing_address,
                sender_logo_url=sender_logo_url,
                tax_percent=data.get("tax_percent", Decimal("0")),
                contingency_percent=data.get("contingency_percent", Decimal("0")),
                overhead_profit_percent=data.get("overhead_profit_percent", Decimal("0")),
                insurance_percent=data.get("insurance_percent", Decimal("0")),
            )

            if apply_error := _apply_quote_lines_and_totals(
                quote=quote,
                line_items_data=line_items,
                tax_percent=data.get("tax_percent", Decimal("0")),
                user=request.user,
                sections_data=data.get("sections"),
                contingency_percent=data.get("contingency_percent", Decimal("0")),
                overhead_profit_percent=data.get("overhead_profit_percent", Decimal("0")),
                insurance_percent=data.get("insurance_percent", Decimal("0")),
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

            # Billing periods (optional — embedded in quote payload)
            billing_periods_data = data.get("billing_periods", [])
            if billing_periods_data:
                BillingPeriod.objects.bulk_create([
                    BillingPeriod(
                        quote=quote,
                        description=p["description"],
                        percent=p["percent"],
                        due_date=p.get("due_date"),
                        order=p["order"],
                    )
                    for p in billing_periods_data
                ])

            quote.refresh_from_db()
            QuoteStatusEvent.record(
                quote=quote,
                from_status=None,
                to_status=quote.status,
                note="Quote created.",
                changed_by=request.user,
            )
            _archive_quote_family(
                project=project,
                user=request.user,
                title=quote.title,
                exclude_ids=[quote.id],
                note=f"Archived because quote #{quote.id} superseded this version.",
            )
        return Response(
            {"data": QuoteSerializer(quote, context={"request": request}).data},
            status=201,
        )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def quote_detail_view(request, quote_id):
    """Fetch or update a single quote with draft-locking enforcement.

    GET returns the quote detail.  PATCH supports three concern paths:
    status transitions (with capability gates per target status), status
    notes (audit-only, no transition), and document saves (field + line-item
    updates).  Non-draft quotes are locked against value edits.

    Flow (GET):
        1. Look up quote scoped to user's org.
        2. Return serialized quote.

    Flow (PATCH):
        1. Capability gate: ``quotes.edit``.
        2. Additional capability gates for send (``quotes.send``) and
           approve/void (``quotes.approve``) transitions.
        3. Reject immutable-field edits (title, terms_text).
        4. Reject value edits on non-draft quotes (locked).
        5. Dispatch to status-transition, status-note, or document-save handler.

    URL: ``GET/PATCH /api/v1/quotes/<quote_id>/``

    Request body (PATCH)::

        { "status": "sent", "status_note": "Sending to client" }

    Success 200::

        { "data": { ... }, "email_sent": false }

    Errors:
        - 400: Immutable field, locked quote, invalid transition.
        - 403: Missing capability for the requested action.
        - 404: Quote not found.
    """
    quote = _validate_quote_for_user(quote_id, request.user)
    if not quote:
        return Response(
            {"error": {"code": "not_found", "message": "Quote not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": QuoteSerializer(quote, context={"request": request}).data})

    elif request.method == "PATCH":
        permission_error, _ = _capability_gate(request.user, "quotes", "edit")
        if permission_error:
            return Response(permission_error, status=403)
        serializer = QuoteWriteSerializer(
            data=request.data,
            partial=True,
        )
        if not serializer.is_valid():
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": _format_serializer_errors(serializer.errors),
                        "fields": serializer.errors,
                    }
                },
                status=400,
            )
        data = serializer.validated_data

        # Status-transition capability gates
        if "status" in data:
            requested_status = data["status"]
            if requested_status in {Quote.Status.SENT}:
                permission_error, _ = _capability_gate(request.user, "quotes", "send")
                if permission_error:
                    return Response(permission_error, status=403)
            elif requested_status in {Quote.Status.APPROVED, Quote.Status.VOID}:
                permission_error, _ = _capability_gate(request.user, "quotes", "approve")
                if permission_error:
                    return Response(permission_error, status=403)

        if "title" in data and data["title"] != quote.title:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Quote title cannot be changed after creation.",
                        "fields": {"title": ["Create a new quote if the title needs to change."]},
                    }
                },
                status=400,
            )
        if "terms_text" in data:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Quote terms are managed by organization templates.",
                        "fields": {
                            "terms_text": [
                                "Set quote terms in Organization settings; per-quote overrides are disabled."
                            ]
                        },
                    }
                },
                status=400,
            )
        is_locked = quote.status != Quote.Status.DRAFT
        mutating_fields = {"title", "valid_through", "tax_percent", "contingency_percent", "overhead_profit_percent", "insurance_percent", "line_items", "sections", "billing_periods", "notes_text"}
        if is_locked and any(field in data for field in mutating_fields):
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Quote values are locked after being sent.",
                        "fields": {
                            "title": ["Cannot edit non-draft quote values."],
                            "valid_through": ["Cannot edit non-draft quote values."],
                            "tax_percent": ["Cannot edit non-draft quote values."],
                            "line_items": ["Cannot edit non-draft quote values."],
                        },
                    }
                },
                status=400,
            )
        # --- Concern dispatch ---
        previous_status = quote.status
        next_status = data.get("status", quote.status)
        status_changing = "status" in data
        is_actual_transition = status_changing and previous_status != next_status
        is_resend = (
            status_changing
            and previous_status == Quote.Status.SENT
            and next_status == Quote.Status.SENT
        )
        status_note = (data.get("status_note", "") or "").strip()

        if is_actual_transition or is_resend:
            return _handle_quote_status_transition(
                request, quote, data,
                previous_status, next_status, is_resend,
            )
        if status_note:
            return _handle_quote_status_note(request, quote, data)
        return _handle_quote_document_save(request, quote, data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def quote_status_events_view(request, quote_id):
    """Return the immutable status-transition audit trail for an quote.

    Flow:
        1. Look up quote scoped to user's org.
        2. Query all status events with related user and project data.

    URL: ``GET /api/v1/quotes/<quote_id>/status-events/``

    Request body: (none)

    Success 200::

        { "data": [{ "from_status": "draft", "to_status": "sent", ... }, ...] }

    Errors:
        - 404: Quote not found.
    """
    quote = _validate_quote_for_user(quote_id, request.user)
    if not quote:
        return Response(
            {"error": {"code": "not_found", "message": "Quote not found.", "fields": {}}},
            status=404,
        )

    status_events = QuoteStatusEvent.objects.filter(quote=quote).select_related(
        "changed_by",
        "quote__project__customer",
    )
    return Response({"data": QuoteStatusEventSerializer(status_events, many=True).data})
