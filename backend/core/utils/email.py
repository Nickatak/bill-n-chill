"""Transactional email helpers with audit logging.

All emails are rendered from Django templates in core/templates/email/.
Each function builds a context dict, renders both HTML and plain text,
and sends via Django's configured EMAIL_BACKEND with an immutable
EmailRecord audit row.
"""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

from core.models import EmailRecord

logger = logging.getLogger(__name__)


def _frontend_url():
    """Return the frontend base URL with trailing slash stripped."""
    return settings.FRONTEND_URL.rstrip("/")


def _render_email(template_name, context):
    """Render an email template pair and return (subject, plain_text, html).

    Adds ``frontend_url`` to every context so the base template footer
    can always link home. Returns stripped strings to avoid leading/trailing
    whitespace from template blocks.
    """
    context.setdefault("frontend_url", _frontend_url())
    html = render_to_string(f"email/{template_name}.html", context).strip()
    text = render_to_string(f"email/{template_name}.txt", context).strip()
    return text, html


def send_verification_email(user, token_obj):
    """Send email verification link and log to EmailRecord.

    Constructs the verification URL from settings.FRONTEND_URL, sends via
    Django's configured EMAIL_BACKEND, and appends an immutable audit row.
    Called outside transaction.atomic() so mail failures don't roll back
    user creation.
    """
    verify_url = f"{_frontend_url()}/verify-email?token={token_obj.token}"
    subject = "Verify your email — Bill n' Chill"
    context = {"verify_url": verify_url}
    body, html = _render_email("verification", context)

    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        html_message=html,
        fail_silently=False,
    )

    EmailRecord.record(
        recipient_email=user.email,
        email_type=EmailRecord.EmailType.VERIFICATION,
        subject=subject,
        body_text=body,
        sent_by_user=user,
        metadata={"verification_token_id": token_obj.id, "user_id": user.id},
    )
    logger.info("Verification email sent to %s", user.email)


def send_password_reset_email(user, token_obj, *, is_security_alert=False):
    """Send password reset link and log to EmailRecord.

    When is_security_alert=True, the email warns the user that someone
    attempted to register with their email address. This variant is sent
    from the registration duplicate handler for verified users.
    """
    reset_url = f"{_frontend_url()}/reset-password?token={token_obj.token}"
    subject = (
        "Password reset request — Bill n' Chill"
        if is_security_alert
        else "Reset your password — Bill n' Chill"
    )
    context = {"reset_url": reset_url, "is_security_alert": is_security_alert}
    body, html = _render_email("password_reset", context)

    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        html_message=html,
        fail_silently=False,
    )

    EmailRecord.record(
        recipient_email=user.email,
        email_type=EmailRecord.EmailType.PASSWORD_RESET,
        subject=subject,
        body_text=body,
        sent_by_user=user,
        metadata={
            "password_reset_token_id": token_obj.id,
            "user_id": user.id,
            "is_security_alert": is_security_alert,
        },
    )
    logger.info("Password reset email sent to %s (security_alert=%s)", user.email, is_security_alert)


def send_otp_email(recipient_email, code, document_type_label, document_title):
    """Send a 6-digit OTP code for public document verification.

    Called when a customer requests identity verification before making a
    decision on a public document link. Logs to EmailRecord for audit.
    """
    subject = "Your verification code — Bill n' Chill"
    context = {
        "code": code,
        "document_type_label": document_type_label,
        "document_title": document_title,
    }
    body, html = _render_email("otp", context)

    if settings.DEBUG:
        logger.debug("OTP code %s for %s (%s: %s)", code, recipient_email, document_type_label, document_title)

    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient_email],
        html_message=html,
        fail_silently=False,
    )

    EmailRecord.record(
        recipient_email=recipient_email,
        email_type=EmailRecord.EmailType.OTP,
        subject=subject,
        body_text=body,
        metadata={"document_type_label": document_type_label, "document_title": document_title},
    )
    logger.info("OTP email sent to %s for %s: %s", recipient_email, document_type_label, document_title)


def send_document_sent_email(*, document_type, document_title, public_url, recipient_email, sender_user):
    """Send notification email when a document is sent to a customer.

    Called after an quote, invoice, or change order transitions to sent/pending.
    Skips silently if the customer has no email on file. Email delivery failures
    are logged but never block the status transition.

    Returns True if the email was sent successfully, False otherwise.
    """
    if not (recipient_email or "").strip():
        return False

    from core.models import OrganizationMembership

    membership = (
        OrganizationMembership.objects
        .select_related("organization")
        .filter(user=sender_user, status=OrganizationMembership.Status.ACTIVE)
        .first()
    )
    org_name = membership.organization.display_name if membership else "Your contractor"

    subject = f"{document_type} from {org_name} — Bill n' Chill"
    context = {
        "document_type": document_type,
        "document_type_lower": document_type.lower(),
        "document_title": document_title,
        "public_url": public_url,
        "org_name": org_name,
    }
    body, html = _render_email("document_sent", context)

    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient_email.strip()],
            html_message=html,
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send %s email to %s", document_type, recipient_email)
        return False

    EmailRecord.record(
        recipient_email=recipient_email.strip(),
        email_type=EmailRecord.EmailType.DOCUMENT_SENT,
        subject=subject,
        body_text=body,
        sent_by_user=sender_user,
        metadata={
            "document_type": document_type,
            "document_title": document_title,
            "public_url": public_url,
        },
    )
    logger.info("Document sent email delivered: %s '%s' to %s", document_type, document_title, recipient_email)

    return True


def send_document_decision_email(*, user_id, document_type, document_title, customer_name, decision, project_url):
    """Send email to document owner when a customer makes a decision.

    Called asynchronously via django-q2 after a customer approves, rejects,
    or disputes a document through the public link. Skips silently if the
    user has no email or the send fails.

    Args:
        user_id: The document owner's user PK.
        document_type: "quote", "invoice", or "change_order".
        document_title: Human-readable document identifier.
        customer_name: The customer who made the decision.
        decision: "approve", "reject", or "dispute".
        project_url: App route to the project's document list.
    """
    from django.contrib.auth import get_user_model
    from core.models import OrganizationMembership

    User = get_user_model()
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        logger.warning("Document decision email skipped — user %s not found", user_id)
        return False

    if not user.email:
        return False

    membership = (
        OrganizationMembership.objects
        .select_related("organization")
        .filter(user=user, status=OrganizationMembership.Status.ACTIVE)
        .first()
    )
    org_name = membership.organization.display_name if membership else "Your organization"

    type_label = document_type.replace("_", " ").title()
    action_past = {"approve": "approved", "reject": "rejected", "dispute": "disputed"}.get(decision, decision)

    subject = f"{type_label} {action_past} by {customer_name} — Bill n' Chill"
    context = {
        "type_label": type_label,
        "type_label_lower": type_label.lower(),
        "action_past": action_past,
        "document_title": document_title,
        "customer_name": customer_name,
        "org_name": org_name,
        "project_url_full": f"{_frontend_url()}{project_url}",
    }
    body, html = _render_email("document_decision", context)

    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            html_message=html,
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send document decision email to %s", user.email)
        return False

    EmailRecord.record(
        recipient_email=user.email,
        email_type=EmailRecord.EmailType.DOCUMENT_DECISION,
        subject=subject,
        body_text=body,
        sent_by_user=user,
        metadata={
            "document_type": document_type,
            "document_title": document_title,
            "customer_name": customer_name,
            "decision": decision,
        },
    )
    logger.info("Document decision email sent: %s %s '%s' to %s", type_label, action_past, document_title, user.email)
    return True
