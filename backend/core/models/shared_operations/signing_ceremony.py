"""Signing ceremony record — immutable audit artifact for public document decisions."""

from django.db import models
from django.utils import timezone

from core.models.mixins import ImmutableModelMixin
from core.models.shared_operations.document_access_session import DocumentAccessSession


class SigningCeremonyRecord(ImmutableModelMixin):
    """Immutable audit artifact created when a customer signs a public document.

    Captures everything needed to prove a specific person approved a specific
    version of a document at a specific time: verified identity (OTP), typed
    name, content hash, IP, user agent, and the exact consent language shown.

    [DRAFT — REQUIRES ATTORNEY REVIEW BEFORE PRODUCTION USE]
    The consent language stored in consent_text_snapshot is placeholder text.
    It must be reviewed by a construction-law attorney before go-live.
    """

    _immutable_label = "Signing ceremony records"

    document_type = models.CharField(
        max_length=20,
        choices=DocumentAccessSession.DocumentType.choices,
    )
    document_id = models.PositiveIntegerField()
    public_token = models.CharField(max_length=24)
    decision = models.CharField(max_length=20)
    signer_name = models.CharField(max_length=200)
    signer_email = models.CharField(max_length=254)
    email_verified = models.BooleanField(default=True)
    content_hash = models.CharField(max_length=64)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    consent_text_version = models.CharField(max_length=64)
    consent_text_snapshot = models.TextField()
    note = models.TextField(blank=True, default="")
    ceremony_completed_at = models.DateTimeField()
    access_session = models.ForeignKey(
        DocumentAccessSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="signing_ceremonies",
    )
    metadata_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @classmethod
    def record(
        cls,
        *,
        document_type,
        document_id,
        public_token,
        decision,
        signer_name,
        signer_email,
        email_verified=True,
        content_hash,
        ip_address=None,
        user_agent="",
        consent_text_version,
        consent_text_snapshot,
        note="",
        access_session=None,
        metadata=None,
    ):
        """Create an immutable signing ceremony audit record."""
        return cls.objects.create(
            document_type=document_type,
            document_id=document_id,
            public_token=public_token,
            decision=decision,
            signer_name=signer_name,
            signer_email=signer_email,
            email_verified=email_verified,
            content_hash=content_hash,
            ip_address=ip_address,
            user_agent=user_agent,
            consent_text_version=consent_text_version,
            consent_text_snapshot=consent_text_snapshot,
            note=note,
            ceremony_completed_at=timezone.now(),
            access_session=access_session,
            metadata_json=metadata or {},
        )

    def __str__(self):
        return (
            f"SigningCeremony {self.document_type}:{self.document_id} "
            f"'{self.decision}' by {self.signer_name}"
        )
