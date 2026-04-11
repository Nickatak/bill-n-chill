"""Async tasks executed by the django-q2 worker (qcluster).

All functions in this module are designed to be called via
``django_q.tasks.async_task("core.tasks.<name>", ...)``.
They must accept only serializable arguments (no model instances).
"""

import functools
import logging

import sentry_sdk

logger = logging.getLogger(__name__)


def _report_to_sentry(func):
    """Capture task exceptions in Sentry before Q2 marks the task as failed."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception:
            sentry_sdk.capture_exception()
            raise
    return wrapper


# ---------------------------------------------------------------------------
# Worker heartbeat
# ---------------------------------------------------------------------------

@_report_to_sentry
def worker_heartbeat_task():
    """Update the worker heartbeat timestamp. Scheduled every 5 minutes."""
    from core.models import WorkerHeartbeat

    WorkerHeartbeat.pulse()


# ---------------------------------------------------------------------------
# Auth emails
# ---------------------------------------------------------------------------

@_report_to_sentry
def send_verification_email_task(user_id, token_id):
    """Send email verification link. Queued from registration and resend flows."""
    from django.contrib.auth import get_user_model
    from core.models import EmailVerificationToken
    from core.utils.email import send_verification_email

    user = get_user_model().objects.get(pk=user_id)
    token_obj = EmailVerificationToken.objects.get(pk=token_id)
    send_verification_email(user, token_obj)


@_report_to_sentry
def send_password_reset_email_task(user_id, token_id, is_security_alert=False):
    """Send password reset link. Queued from forgot-password and resend flows."""
    from django.contrib.auth import get_user_model
    from core.models import PasswordResetToken
    from core.utils.email import send_password_reset_email

    user = get_user_model().objects.get(pk=user_id)
    token_obj = PasswordResetToken.objects.get(pk=token_id)
    send_password_reset_email(user, token_obj, is_security_alert=is_security_alert)


# ---------------------------------------------------------------------------
# Public document emails
# ---------------------------------------------------------------------------

@_report_to_sentry
def send_otp_email_task(recipient_email, code, document_type_label, document_title):
    """Send OTP code for public document verification ceremony."""
    from core.utils.email import send_otp_email

    send_otp_email(recipient_email, code, document_type_label, document_title)


@_report_to_sentry
def send_document_sent_email_task(document_type, document_title, public_url, recipient_email, sender_user_id):
    """Send notification when a document is sent to a customer."""
    from django.contrib.auth import get_user_model
    from core.utils.email import send_document_sent_email

    sender_user = get_user_model().objects.get(pk=sender_user_id)
    send_document_sent_email(
        document_type=document_type,
        document_title=document_title,
        public_url=public_url,
        recipient_email=recipient_email,
        sender_user=sender_user,
    )


# ---------------------------------------------------------------------------
# Document decision notifications (push + email)
# ---------------------------------------------------------------------------

@_report_to_sentry
def send_document_decision_notification(user_id, document_type, document_title, customer_name, decision, project_url):
    """Send push + email notification to document owner after a customer decision.

    Queued from public decision views so the customer's response is not
    blocked by notification delivery latency.
    """
    from core.utils.push import send_push_to_user, build_document_decision_payload
    from core.utils.email import send_document_decision_email

    push_payload = build_document_decision_payload(
        document_type=document_type,
        document_title=document_title,
        customer_name=customer_name,
        decision=decision,
        url=project_url,
    )
    send_push_to_user(user_id, push_payload)

    send_document_decision_email(
        user_id=user_id,
        document_type=document_type,
        document_title=document_title,
        customer_name=customer_name,
        decision=decision,
        project_url=project_url,
    )
