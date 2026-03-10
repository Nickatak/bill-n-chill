"""Transactional email helpers with audit logging."""

import logging

from django.conf import settings
from django.core.mail import send_mail

from core.models import EmailRecord

logger = logging.getLogger(__name__)


def send_verification_email(user, token_obj):
    """Send email verification link and log to EmailRecord.

    Constructs the verification URL from settings.FRONTEND_URL, sends via
    Django's configured EMAIL_BACKEND, and appends an immutable audit row.
    Called outside transaction.atomic() so mail failures don't roll back
    user creation.
    """
    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token_obj.token}"
    subject = "Verify your email — Bill n' Chill"
    body = (
        f"Welcome to Bill n' Chill!\n\n"
        f"Click the link below to verify your email address:\n\n"
        f"{verify_url}\n\n"
        f"This link expires in 24 hours.\n\n"
        f"If you didn't create this account, you can safely ignore this email."
    )

    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
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


def send_password_reset_email(user, token_obj, *, is_security_alert=False):
    """Send password reset link and log to EmailRecord.

    When is_security_alert=True, the email warns the user that someone
    attempted to register with their email address. This variant is sent
    from the registration duplicate handler for verified users.
    """
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={token_obj.token}"

    if is_security_alert:
        subject = "Password reset request — Bill n' Chill"
        body = (
            f"Someone tried to create a new account using your email address.\n\n"
            f"If this was you and you forgot your password, click the link below to reset it:\n\n"
            f"{reset_url}\n\n"
            f"This link expires in 1 hour.\n\n"
            f"If this wasn't you, you can safely ignore this email. Your account is secure."
        )
    else:
        subject = "Reset your password — Bill n' Chill"
        body = (
            f"We received a request to reset your password.\n\n"
            f"Click the link below to choose a new password:\n\n"
            f"{reset_url}\n\n"
            f"This link expires in 1 hour.\n\n"
            f"If you didn't request this, you can safely ignore this email."
        )

    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
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


def send_otp_email(recipient_email, code, document_type_label, document_title):
    """Send a 6-digit OTP code for public document verification.

    Called when a customer requests identity verification before making a
    decision on a public document link. Logs to EmailRecord for audit.
    """
    subject = "Your verification code — Bill n' Chill"
    body = (
        f"Your verification code is: {code}\n\n"
        f"Use this code to verify your identity before signing:\n"
        f"{document_type_label}: {document_title}\n\n"
        f"This code expires in 10 minutes.\n\n"
        f"If you did not request this code, you can safely ignore this email."
    )

    if settings.DEBUG:
        print(f"[OTP] Code {code} for {recipient_email} ({document_type_label}: {document_title})")

    send_mail(
        subject=subject,
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient_email],
        fail_silently=False,
    )

    EmailRecord.record(
        recipient_email=recipient_email,
        email_type=EmailRecord.EmailType.OTP,
        subject=subject,
        body_text=body,
        metadata={"document_type_label": document_type_label, "document_title": document_title},
    )


def send_document_sent_email(*, document_type, document_title, public_url, recipient_email, sender_user):
    """Send notification email when a document is sent to a customer.

    Called after an estimate, invoice, or change order transitions to sent/pending.
    Skips silently if the customer has no email on file. Email delivery failures
    are logged but never block the status transition.
    """
    if not (recipient_email or "").strip():
        return

    from core.models import OrganizationMembership

    membership = (
        OrganizationMembership.objects
        .select_related("organization")
        .filter(user=sender_user, status=OrganizationMembership.Status.ACTIVE)
        .first()
    )
    org_name = membership.organization.display_name if membership else "Your contractor"

    subject = f"{document_type} from {org_name} — Bill n' Chill"
    body = (
        f"{org_name} has sent you a new {document_type.lower()}.\n\n"
        f"{document_title}\n\n"
        f"View and respond here:\n"
        f"{public_url}\n\n"
        f"If you have questions, please contact {org_name} directly."
    )

    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient_email.strip()],
            fail_silently=False,
        )
    except Exception as exc:
        logger.exception("Failed to send %s email to %s", document_type, recipient_email)
        return

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
