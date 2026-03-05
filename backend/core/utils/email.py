"""Transactional email helpers with audit logging."""

from django.conf import settings
from django.core.mail import send_mail

from core.models import EmailRecord


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
