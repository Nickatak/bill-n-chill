"""Accounts receivable invoice endpoints and state transitions."""

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import Invoice, InvoiceStatusEvent, SigningCeremonyRecord
from core.policies import get_invoice_policy_contract
from core.serializers import (
    InvoiceSerializer,
    InvoiceStatusEventSerializer,
    InvoiceWriteSerializer,
)
from core.utils.email import send_document_sent_email
from core.utils.request import get_client_ip
from core.utils.signing import compute_document_content_hash
from core.views.accounts_receivable.invoice_ingress import (
    build_invoice_create_ingress,
    build_invoice_patch_ingress,
)
from core.views.accounts_receivable.invoices_helpers import (
    _activate_project_from_invoice_creation,
    _apply_invoice_lines_and_totals,
    _handle_invoice_document_save,
    _handle_invoice_status_note,
    _handle_invoice_status_transition,
    _invoice_line_apply_error_response,
    _next_invoice_number,
)
from core.views.helpers import (
    _build_public_decision_note,
    _capability_gate,
    _ensure_membership,
    _resolve_organization_for_public_actor,
    _serialize_public_organization_context,
    _serialize_public_project_context,
    _validate_project_for_user,
)
from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def org_invoices_view(request):
    """Org-level invoice list — all invoices across all projects for the accounting page."""
    membership = _ensure_membership(request.user)
    rows = (
        Invoice.objects.filter(project__organization_id=membership.organization_id)
        .select_related("project", "customer")
        .prefetch_related(
            "line_items",
            "line_items__cost_code",
            "payment_allocations",
            "payment_allocations__payment",
        )
        .order_by("-created_at")
    )
    return Response({"data": InvoiceSerializer(rows, many=True).data})


@api_view(["GET"])
@permission_classes([AllowAny])
def public_invoice_detail_view(request, public_token: str):
    """Return public invoice detail for share links, including lightweight project context."""
    try:
        invoice = (
            Invoice.objects.select_related("project__customer", "created_by")
            .prefetch_related(
                "line_items",
                "line_items__cost_code",
            )
            .get(public_token=public_token)
        )
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    serialized = InvoiceSerializer(invoice).data
    organization = _resolve_organization_for_public_actor(invoice.created_by)
    serialized["project_context"] = _serialize_public_project_context(invoice.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization, request=request)
    consent_text, consent_version = get_ceremony_context()
    serialized["ceremony_consent_text"] = consent_text
    serialized["ceremony_consent_text_version"] = consent_version
    return Response({"data": serialized})


@api_view(["POST"])
@permission_classes([AllowAny])
def public_invoice_decision_view(request, public_token: str):
    """Apply customer approval/dispute decision to a public invoice share link."""
    try:
        invoice = (
            Invoice.objects.select_related("project", "project__customer", "created_by")
            .prefetch_related(
                "line_items",
                "line_items__cost_code",
            )
            .get(public_token=public_token)
        )
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    current_status = invoice.status
    if current_status not in {
        Invoice.Status.SENT,
        Invoice.Status.PARTIALLY_PAID,
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
    client_ua = request.META.get("HTTP_USER_AGENT", "")
    with transaction.atomic():
        previous_status = invoice.status
        if decision_type == "approve":
            if not Invoice.is_transition_allowed(previous_status, Invoice.Status.PAID):
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": f"Invalid invoice status transition: {previous_status} -> paid.",
                            "fields": {"status": ["This transition is not allowed."]},
                        }
                    },
                    status=400,
                )
            invoice.status = Invoice.Status.PAID
            invoice.save(update_fields=["status", "updated_at"])
            InvoiceStatusEvent.record(
                invoice=invoice,
                from_status=previous_status,
                to_status=invoice.status,
                note=public_note,
                changed_by=invoice.created_by,
                ip_address=client_ip,
                user_agent=client_ua,
            )
        else:
            InvoiceStatusEvent.record(
                invoice=invoice,
                from_status=previous_status,
                to_status=previous_status,
                note=public_note,
                changed_by=invoice.created_by,
                ip_address=client_ip,
                user_agent=client_ua,
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
            user_agent=client_ua,
            consent_text_version=consent_version,
            consent_text_snapshot=consent_text,
            note=str(request.data.get("note", "") or "").strip(),
            access_session=ceremony_session,
        )

    refreshed = (
        Invoice.objects.filter(id=invoice.id)
        .select_related("project__customer", "created_by")
        .prefetch_related(
            "line_items",
            "line_items__cost_code",
        )
        .get()
    )
    serialized = InvoiceSerializer(refreshed).data
    organization = _resolve_organization_for_public_actor(refreshed.created_by)
    serialized["project_context"] = _serialize_public_project_context(refreshed.project)
    serialized["organization_context"] = _serialize_public_organization_context(organization, request=request)

    return Response({"data": serialized, "meta": {"public_decision_applied": decision_type}})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_contract_view(_request):
    """Return canonical invoice workflow policy for frontend UX guards."""
    return Response({"data": get_invoice_policy_contract()})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_invoices_view(request, project_id: int):
    """Project invoice collection endpoint: `GET` lists invoices, `POST` creates a draft."""
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = (
            Invoice.objects.filter(project=project)
            .select_related("customer")
            .prefetch_related(
                "line_items",
                "line_items__cost_code",
            )
            .order_by("-created_at")
        )
        return Response({"data": InvoiceSerializer(rows, many=True).data})

    permission_error, _ = _capability_gate(request.user, "invoices", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = InvoiceWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    membership = _ensure_membership(request.user)
    organization = membership.organization
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
            created_by=request.user,
        )

        apply_error = _apply_invoice_lines_and_totals(
            invoice=invoice,
            line_items_data=line_items,
            tax_percent=ingress.tax_percent,
            user=request.user,
        )
        if apply_error:
            transaction.set_rollback(True)
            payload, status_code = _invoice_line_apply_error_response(apply_error)
            return Response(payload, status=status_code)

        invoice.refresh_from_db()
        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=None,
            to_status=invoice.status,
            note="Invoice created.",
            changed_by=request.user,
        )
        _activate_project_from_invoice_creation(invoice=invoice, actor=request.user)
    return Response({"data": InvoiceSerializer(invoice).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def invoice_detail_view(request, invoice_id: int):
    """Fetch or update one invoice while enforcing lifecycle and totals rules."""
    membership = _ensure_membership(request.user)
    try:
        invoice = (
            Invoice.objects.select_related("customer")
            .prefetch_related(
                "line_items",
                "line_items__cost_code",
            )
            .get(
                id=invoice_id,
                project__organization_id=membership.organization_id,
            )
        )
    except Invoice.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Invoice not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": InvoiceSerializer(invoice).data})

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
    if note_text:
        return _handle_invoice_status_note(request, invoice, ingress)
    return _handle_invoice_document_save(request, invoice, ingress)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def invoice_send_view(request, invoice_id: int):
    """Send an invoice by transitioning to `sent`."""
    membership = _ensure_membership(request.user)
    try:
        invoice = Invoice.objects.get(id=invoice_id, project__organization_id=membership.organization_id)
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

        # Freeze org identity and T&C onto the document when leaving draft.
        update_fields = ["status", "updated_at"]
        if previous_status == Invoice.Status.DRAFT:
            organization = membership.organization
            if not (invoice.terms_text or "").strip():
                org_terms = (organization.invoice_terms_and_conditions or "").strip()
                if org_terms:
                    invoice.terms_text = org_terms
                    update_fields.append("terms_text")
            if not (invoice.sender_name or "").strip():
                org_name = (organization.display_name or "").strip()
                if org_name:
                    invoice.sender_name = org_name
                    update_fields.append("sender_name")
            if not (invoice.sender_address or "").strip():
                org_address = organization.formatted_billing_address
                if org_address:
                    invoice.sender_address = org_address
                    update_fields.append("sender_address")
            if not (invoice.sender_logo_url or "").strip():
                if organization.logo:
                    invoice.sender_logo_url = request.build_absolute_uri(organization.logo.url)
                    update_fields.append("sender_logo_url")

        invoice.save(update_fields=update_fields)
        InvoiceStatusEvent.record(
            invoice=invoice,
            from_status=previous_status,
            to_status=Invoice.Status.SENT,
            note="Invoice sent.",
            changed_by=request.user,
        )

    customer_email = (invoice.customer.email or "").strip()
    email_sent = send_document_sent_email(
        document_type="Invoice",
        document_title=f"Invoice {invoice.invoice_number}",
        public_url=f"{settings.FRONTEND_URL}/invoice/{invoice.public_ref}",
        recipient_email=customer_email,
        sender_user=request.user,
    )

    return Response({"data": InvoiceSerializer(invoice).data, "email_sent": email_sent})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_status_events_view(request, invoice_id: int):
    """Return immutable invoice status transition history for one invoice."""
    membership = _ensure_membership(request.user)
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
