"""Accounts receivable invoice endpoints and state transitions."""

import logging

logger = logging.getLogger(__name__)

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import Estimate, Invoice, InvoiceStatusEvent, SigningCeremonyRecord
from core.policies import get_invoice_policy_contract
from core.serializers import (
    InvoiceSerializer,
    InvoiceStatusEventSerializer,
    InvoiceWriteSerializer,
)
from django_q.tasks import async_task
from core.utils.request import get_client_ip
from core.utils.signing import compute_document_content_hash
from core.views.accounts_receivable.invoice_ingress import (
    build_invoice_create_ingress,
    build_invoice_patch_ingress,
)
from core.views.accounts_receivable.invoices_helpers import (
    _activate_project_from_invoice_creation,
    _apply_invoice_lines_and_totals,
    _freeze_org_identity_on_invoice,
    _handle_invoice_document_save,
    _handle_invoice_status_note,
    _handle_invoice_status_transition,
    _invoice_line_apply_error_response,
    _next_invoice_number,
    _prefetch_invoice_qs,
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
@permission_classes([IsAuthenticated])
def org_invoices_view(request):
    """List all invoices across all projects for the authenticated user's org.

    Used by the accounting page to show a unified AR ledger.

    Flow:
        1. Resolve org membership.
        2. Query all invoices scoped to the org, ordered by date descending.
        3. Return serialized list with eagerly loaded relations.

    URL: ``GET /api/v1/invoices/``

    Request body: (none)

    Success 200::

        { "data": [ { ... }, ... ] }
    """
    membership = _ensure_org_membership(request.user)
    invoices = _prefetch_invoice_qs(
        Invoice.objects.filter(project__organization_id=membership.organization_id)
        .order_by("-created_at")
    )
    return Response({"data": InvoiceSerializer(invoices, many=True).data})


@api_view(["GET"])
@permission_classes([AllowAny])
def public_invoice_detail_view(request, public_token: str):
    """Return public invoice detail for share links, including project context.

    Public (no auth) endpoint used by customer-facing share links. Returns
    the full invoice with project context, organization identity, and signing
    ceremony consent text for the decision form.

    Flow:
        1. Look up the invoice by public token.
        2. Reject draft documents (not yet sent to customer).
        3. Resolve the organization from the invoice creator.
        4. Attach project context, organization context, and ceremony consent.
        5. Return the enriched serialized invoice.

    URL: ``GET /api/v1/public/invoices/<public_token>/``

    Request body: (none)

    Success 200::

        { "data": { ..., "project_context": { ... }, "organization_context": { ... } } }

    Errors:
        - 404: Invoice not found or still in draft status.
    """
    try:
        invoice = _prefetch_invoice_qs(
            Invoice.objects.filter(public_token=public_token)
        ).get()
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    if invoice.status == Invoice.Status.DRAFT:
        return Response(
            {"error": {"code": "not_available", "message": "This invoice is not yet available.", "fields": {}}},
            status=404,
        )

    invoice_data = InvoiceSerializer(invoice).data
    organization = _resolve_organization_for_public_actor(invoice.created_by)
    invoice_data["project_context"] = _serialize_public_project_context(invoice.project)
    invoice_data["organization_context"] = _serialize_public_organization_context(organization, request=request)
    consent_text, consent_version = get_ceremony_context()
    invoice_data["ceremony_consent_text"] = consent_text
    invoice_data["ceremony_consent_text_version"] = consent_version
    return Response({"data": invoice_data})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_invoice_decision_view(request, public_token: str):
    """Apply a customer approval or dispute decision to a public invoice.

    Public (no auth) endpoint for customer decisions on shared invoices.
    Validates the signing ceremony (OTP verification), records the decision
    as an audit event, and creates an immutable signing ceremony record.

    Flow:
        1. Look up the invoice by public token.
        2. Verify the invoice is in a decision-eligible status (sent or partially paid).
        3. Parse and validate the decision type (approve/pay or dispute/reject).
        4. Validate the signing ceremony session (OTP verification).
        5. Build the public decision note with signer identity.
        6. Apply the decision atomically: update status (if approved), record
           audit event, and create signing ceremony record.
        7. Return the refreshed invoice with project and organization context.

    URL: ``POST /api/v1/public/invoices/<public_token>/decision/``

    Request body::

        {
            "decision": "string (required — 'approve'/'pay' or 'dispute'/'reject')",
            "note": "string (optional — customer note)"
        }

    Success 200::

        { "data": { ... }, "meta": { "public_decision_applied": "approve|dispute" } }

    Errors:
        - 400: Invalid decision value or disallowed status transition.
        - 404: Invoice not found for the given token.
        - 409: Invoice not in a decision-eligible status.
    """
    try:
        invoice = _prefetch_invoice_qs(
            Invoice.objects.filter(public_token=public_token)
        ).get()
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    current_status = invoice.status
    if current_status not in {
        Invoice.Status.SENT,
        Invoice.Status.OUTSTANDING,
    }:
        return Response(
            {
                "error": {
                    "code": "conflict",
                    "message": "This invoice is not awaiting customer decision.",
                    "fields": {"status": [f"Current status is '{current_status}'."]},
                }
            },
            status=409,
        )

    decision = str(request.data.get("decision", "")).strip().lower()
    decision_type = None
    if decision in {"approve", "approved", "pay", "paid"}:
        decision_type = "approve"
    elif decision in {"dispute", "disputed", "reject", "rejected"}:
        decision_type = "dispute"

    if not decision_type:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid public decision for invoice.",
                    "fields": {"decision": ["Use 'approve'/'pay' or 'dispute'."]},
                }
            },
            status=400,
        )

    # --- Ceremony validation ---
    customer_email = (invoice.project.customer.email or "").strip()
    ceremony_session, signer_name, ceremony_error = validate_ceremony_on_decision(
        request, public_token, customer_email,
    )
    if ceremony_error:
        return ceremony_error

    public_note = _build_public_decision_note(
        action_label="Approved for payment" if decision_type == "approve" else "Disputed",
        note=str(request.data.get("note", "") or ""),
        decider_name=signer_name,
        decider_email=ceremony_session.recipient_email if ceremony_session else "",
    )

    consent_text, consent_version = get_ceremony_context()
    client_ip = get_client_ip(request)
    user_agent = request.META.get("HTTP_USER_AGENT", "")
    with transaction.atomic():
        # Customer decisions (approve/dispute) record an audit event but
        # do not change the invoice status.  Payment status is derived from
        # actual payment allocations, not customer acknowledgement.
        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=current_status,
            to_status=current_status,
            note=public_note,
            changed_by=invoice.created_by,
            ip_address=client_ip,
            user_agent=user_agent,
        )

        content_hash = compute_document_content_hash("invoice", InvoiceSerializer(invoice).data)
        SigningCeremonyRecord.record(
            document_type="invoice",
            document_id=invoice.id,
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

    logger.info("Invoice public decision: id=%s %s decision=%s from=%s", invoice.id, invoice.invoice_number, decision_type, client_ip)

    # Queue push + email notification to document owner (non-blocking).
    async_task(
        "core.tasks.send_document_decision_notification",
        invoice.created_by_id,
        "invoice",
        invoice.invoice_number,
        invoice.project.customer.display_name,
        decision_type,
        f"/projects/{invoice.project_id}/invoices",
    )

    refreshed = _prefetch_invoice_qs(
        Invoice.objects.filter(id=invoice.id)
    ).get()
    invoice_data = InvoiceSerializer(refreshed).data
    organization = _resolve_organization_for_public_actor(refreshed.created_by)
    invoice_data["project_context"] = _serialize_public_project_context(refreshed.project)
    invoice_data["organization_context"] = _serialize_public_organization_context(organization, request=request)

    return Response({"data": invoice_data, "meta": {"public_decision_applied": decision_type}})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_contract_view(_request):
    """Return the invoice workflow policy contract for frontend UX guards.

    Read-only endpoint returning the canonical status/transition definitions
    that the frontend uses to render status dropdowns and transition buttons.

    Flow:
        1. Return the policy contract payload.

    URL: ``GET /api/v1/contracts/invoices/``

    Request body: (none)

    Success 200::

        { "data": { "statuses": [...], "transitions": {...}, ... } }
    """
    return Response({"data": get_invoice_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_invoices_view(request, project_id: int):
    """List or create invoices for a project.

    ``GET`` returns all invoices for the project. ``POST`` creates a new
    draft invoice with line items; applies org defaults for sender identity,
    terms, and due-date delta.

    Flow (GET):
        1. Validate the project belongs to the user's org.
        2. Query all invoices for the project, ordered by date descending.
        3. Return serialized list with eagerly loaded relations.

    Flow (POST):
        1. Validate the project belongs to the user's org.
        2. Gate on ``invoices.create`` capability.
        2b. Reject if project is cancelled (terminal guard).
        3. Normalize the request payload via ingress adapter.
        4. Validate line items are present and due_date >= issue_date.
        5. Create the invoice, apply line items, compute totals atomically.
        6. Record the initial status event and activate prospect projects.
        7. Return the serialized invoice.

    URL: ``GET|POST /api/v1/projects/<project_id>/invoices/``

    Request body (POST)::

        {
            "issue_date": "YYYY-MM-DD (optional, defaults to today)",
            "due_date": "YYYY-MM-DD (optional, defaults to issue_date + org delta)",
            "sender_name": "string (optional, defaults to org name)",
            "sender_email": "string (optional)",
            "sender_address": "string (optional, defaults to org address)",
            "terms_text": "string (optional, defaults to org terms)",
            "tax_percent": "decimal (optional, default=0)",
            "line_items": [ { "cost_code": "int?", "description": "str?", "quantity": "decimal", "unit": "str?", "unit_price": "decimal" } ]
        }

    Success 200 (GET)::

        { "data": [ { ... }, ... ] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Validation failure (empty line items, bad dates).
        - 403: Missing ``invoices.create`` capability.
        - 404: Project not found or not in user's org.
    """
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        invoices = _prefetch_invoice_qs(
            Invoice.objects.filter(project=project).order_by("-created_at")
        )
        return Response({"data": InvoiceSerializer(invoices, many=True).data})

    else:  # POST
        permission_error, _ = _capability_gate(request.user, "invoices", "create")
        if permission_error:
            return Response(permission_error, status=403)

        terminal_error = _check_project_accepts_document(project, "invoices")
        if terminal_error:
            return terminal_error

        serializer = InvoiceWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        organization = project.organization
        default_due_days = int(organization.default_invoice_due_delta or 30)
        default_due_days = max(1, min(default_due_days, 365))
        ingress = build_invoice_create_ingress(
            serializer.validated_data,
            default_issue_date=timezone.localdate(),
            default_due_days=default_due_days,
            default_sender_name=(organization.display_name or "").strip(),
            default_sender_email="",
            default_sender_address=organization.formatted_billing_address,
            default_sender_logo_url=request.build_absolute_uri(organization.logo.url) if organization.logo else "",
            default_terms_text=(organization.invoice_terms_and_conditions or "").strip(),
            default_footer_text="",
            default_notes_text="",
        )
        line_items = ingress.line_items
        if not line_items:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "At least one invoice line item is required.",
                        "fields": {"line_items": ["At least one line item is required."]},
                    }
                },
                status=400,
            )

        issue_date = ingress.issue_date
        due_date = ingress.due_date
        if due_date < issue_date:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "due_date cannot be before issue_date.",
                        "fields": {"due_date": ["Due date must be on or after issue date."]},
                    }
                },
                status=400,
            )

        # --- Validate related_estimate and billing_period if provided ---
        related_estimate = None
        billing_period = None
        if ingress.related_estimate_id:
            try:
                related_estimate = Estimate.objects.get(
                    id=ingress.related_estimate_id,
                    project=project,
                )
            except Estimate.DoesNotExist:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Estimate not found for this project.",
                            "fields": {"related_estimate": ["Estimate not found for this project."]},
                        }
                    },
                    status=400,
                )
            # Validate billing_period belongs to the related estimate.
            if ingress.billing_period_id:
                from core.models import BillingPeriod
                try:
                    billing_period = BillingPeriod.objects.get(
                        id=ingress.billing_period_id,
                        estimate=related_estimate,
                    )
                except BillingPeriod.DoesNotExist:
                    return Response(
                        {
                            "error": {
                                "code": "validation_error",
                                "message": "Billing period not found for this estimate.",
                                "fields": {"billing_period": ["Billing period not found for this estimate."]},
                            }
                        },
                        status=400,
                    )
                # Guard: one non-void invoice per billing period.
                if Invoice.objects.filter(
                    billing_period=billing_period,
                ).exclude(status=Invoice.Status.VOID).exists():
                    return Response(
                        {
                            "error": {
                                "code": "conflict",
                                "message": "An invoice already exists for this billing period.",
                                "fields": {"billing_period": ["An active invoice is already linked to this billing period."]},
                            }
                        },
                        status=409,
                    )
            else:
                # No billing period — guard: one invoice per estimate.
                if Invoice.objects.filter(
                    related_estimate=related_estimate,
                ).exclude(status=Invoice.Status.VOID).exists():
                    return Response(
                        {
                            "error": {
                                "code": "conflict",
                                "message": "An invoice already exists for this estimate.",
                                "fields": {"related_estimate": ["An active invoice is already linked to this estimate."]},
                            }
                        },
                        status=409,
                    )

        # --- Check send capability upfront if initial_status is sent ---
        send_immediately = ingress.initial_status == "sent"
        if send_immediately:
            send_error, _ = _capability_gate(request.user, "invoices", "send")
            if send_error:
                return Response(send_error, status=403)

        with transaction.atomic():
            invoice = Invoice.objects.create(
                project=project,
                customer=project.customer,
                invoice_number=_next_invoice_number(project=project, user=request.user),
                status=Invoice.Status.DRAFT,
                issue_date=issue_date,
                due_date=due_date,
                sender_name=ingress.sender_name,
                sender_email=ingress.sender_email,
                sender_address=ingress.sender_address,
                sender_logo_url=ingress.sender_logo_url,
                terms_text=ingress.terms_text,
                footer_text=ingress.footer_text,
                notes_text=ingress.notes_text,
                tax_percent=ingress.tax_percent,
                related_estimate=related_estimate,
                billing_period=billing_period,
                created_by=request.user,
            )

            if apply_error := _apply_invoice_lines_and_totals(
                invoice=invoice,
                line_items_data=line_items,
                tax_percent=ingress.tax_percent,
                user=request.user,
            ):
                transaction.set_rollback(True)
                payload, status_code = _invoice_line_apply_error_response(apply_error)
                return Response(payload, status=status_code)

            invoice.refresh_from_db()
            InvoiceStatusEvent.record(
                invoice=invoice,
                from_status=None,
                to_status=Invoice.Status.DRAFT,
                note="Invoice created.",
                changed_by=request.user,
            )

            # --- Atomic send if requested ---
            if send_immediately:
                invoice.status = Invoice.Status.SENT
                update_fields = ["status", "updated_at"]
                _freeze_org_identity_on_invoice(
                    invoice, organization, request, update_fields,
                )
                invoice.save(update_fields=update_fields)
                InvoiceStatusEvent.record(
                    invoice=invoice,
                    from_status=Invoice.Status.DRAFT,
                    to_status=Invoice.Status.SENT,
                    note="Invoice sent.",
                    changed_by=request.user,
                )

            _activate_project_from_invoice_creation(invoice=invoice, actor=request.user)

        # --- Queue email outside transaction if sent ---
        email_sent = False
        if send_immediately:
            customer_email = (invoice.customer.email or "").strip()
            if customer_email:
                async_task(
                    "core.tasks.send_document_sent_email_task",
                    "Invoice",
                    f"Invoice {invoice.invoice_number}",
                    f"{settings.FRONTEND_URL}/invoice/{invoice.public_ref}",
                    customer_email,
                    request.user.id,
                )
                email_sent = True

        response_data = {"data": InvoiceSerializer(invoice).data}
        if send_immediately:
            response_data["email_sent"] = email_sent
        return Response(response_data, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def invoice_detail_view(request, invoice_id: int):
    """Fetch or patch an invoice with lifecycle and line item guardrails.

    ``GET`` returns the hydrated invoice. ``PATCH`` applies field updates,
    line item changes, status transitions, or status notes — dispatching to
    the appropriate concern handler.

    Flow (GET):
        1. Validate the invoice belongs to the user's org.
        2. Return the serialized invoice with eagerly loaded relations.

    Flow (PATCH):
        1. Validate the invoice belongs to the user's org.
        2. Gate on ``invoices.edit`` capability.
        3. Normalize the request payload via ingress adapter.
        4. Dispatch to concern handler: status transition, status note, or document save.

    URL: ``GET|PATCH /api/v1/invoices/<invoice_id>/``

    Request body (PATCH)::

        {
            "status": "string (optional — triggers transition if changed)",
            "status_note": "string (optional — triggers note event)",
            "issue_date": "YYYY-MM-DD (optional)",
            "due_date": "YYYY-MM-DD (optional)",
            "tax_percent": "decimal (optional)",
            "line_items": [ ... ] (optional)
        }

    Success 200::

        { "data": { ... }, "email_sent": false }

    Errors:
        - 400: Validation or transition failure.
        - 403: Missing capability.
        - 404: Invoice not found or not in user's org.
    """
    membership = _ensure_org_membership(request.user)
    try:
        invoice = _prefetch_invoice_qs(
            Invoice.objects.filter(
                id=invoice_id,
                project__organization_id=membership.organization_id,
            )
        ).get()
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": InvoiceSerializer(invoice).data})

    else:  # PATCH
        permission_error, _ = _capability_gate(request.user, "invoices", "edit")
        if permission_error:
            return Response(permission_error, status=403)

        serializer = InvoiceWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        ingress = build_invoice_patch_ingress(serializer.validated_data)

        # --- Concern dispatch ---
        previous_status = invoice.status
        next_status = ingress.status if ingress.has_status else previous_status
        is_actual_transition = ingress.has_status and previous_status != next_status
        is_resend = (
            ingress.has_status
            and previous_status == Invoice.Status.SENT
            and next_status == Invoice.Status.SENT
        )
        note_text = ingress.status_note.strip() if ingress.has_status_note else ""

        if is_actual_transition or is_resend:
            return _handle_invoice_status_transition(
                request, invoice, ingress, membership,
                previous_status, next_status, is_resend,
            )
        elif note_text:
            return _handle_invoice_status_note(request, invoice, ingress)
        else:
            return _handle_invoice_document_save(request, invoice, ingress)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def invoice_send_view(request, invoice_id: int):
    """Send an invoice by transitioning to ``sent`` status.

    Dedicated send endpoint that validates the transition, freezes org
    identity onto the document when leaving draft, records an audit event,
    and dispatches the customer notification email.

    Flow:
        1. Validate the invoice belongs to the user's org.
        2. Gate on ``invoices.send`` capability.
        3. Validate the status transition to ``sent`` is allowed.
        4. Freeze org identity fields onto the invoice (if leaving draft).
        5. Save status, record audit event.
        6. Send customer notification email (outside transaction).
        7. Return the serialized invoice with email delivery status.

    URL: ``POST /api/v1/invoices/<invoice_id>/send/``

    Request body: (none)

    Success 200::

        { "data": { ... }, "email_sent": true|false }

    Errors:
        - 400: Status transition to ``sent`` is not allowed.
        - 403: Missing ``invoices.send`` capability.
        - 404: Invoice not found or not in user's org.
    """
    membership = _ensure_org_membership(request.user)
    try:
        invoice = _prefetch_invoice_qs(
            Invoice.objects.filter(id=invoice_id, project__organization_id=membership.organization_id)
        ).get()
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _capability_gate(request.user, "invoices", "send")
    if permission_error:
        return Response(permission_error, status=403)

    if not Invoice.is_transition_allowed(
        current_status=invoice.status,
        next_status=Invoice.Status.SENT,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid invoice status transition: {invoice.status} -> sent.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        previous_status = invoice.status
        invoice.status = Invoice.Status.SENT

        # Freeze org identity onto the document when leaving draft.
        update_fields = ["status", "updated_at"]
        if previous_status == Invoice.Status.DRAFT:
            _freeze_org_identity_on_invoice(
                invoice, membership.organization, request, update_fields,
            )

        invoice.save(update_fields=update_fields)
        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=previous_status,
            to_status=Invoice.Status.SENT,
            note="Invoice sent.",
            changed_by=request.user,
        )

    customer_email = (invoice.customer.email or "").strip()
    email_sent = False
    if customer_email:
        async_task(
            "core.tasks.send_document_sent_email_task",
            "Invoice",
            f"Invoice {invoice.invoice_number}",
            f"{settings.FRONTEND_URL}/invoice/{invoice.public_ref}",
            customer_email,
            request.user.id,
        )
        email_sent = True

    return Response({"data": InvoiceSerializer(invoice).data, "email_sent": email_sent})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_status_events_view(request, invoice_id: int):
    """Return the immutable status transition history for an invoice.

    Flow:
        1. Validate the invoice belongs to the user's org.
        2. Query all status events ordered by most recent first.
        3. Return serialized event list.

    URL: ``GET /api/v1/invoices/<invoice_id>/status-events/``

    Request body: (none)

    Success 200::

        { "data": [ { "from_status": "...", "to_status": "...", ... }, ... ] }

    Errors:
        - 404: Invoice not found or not in user's org.
    """
    membership = _ensure_org_membership(request.user)
    try:
        invoice = Invoice.objects.get(id=invoice_id, project__organization_id=membership.organization_id)
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    events = InvoiceStatusEvent.objects.filter(invoice=invoice).select_related(
        "changed_by",
        "invoice__customer",
        "invoice__project__customer",
    )
    return Response({"data": InvoiceStatusEventSerializer(events, many=True).data})
