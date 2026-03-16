"""Estimate model — mutable operational record for customer-facing project cost proposals."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.text import slugify

from core.models.mixins import StatusTransitionMixin
from core.utils.tokens import generate_public_token

User = get_user_model()


class Estimate(StatusTransitionMixin, models.Model):
    """Customer-facing scope and price proposal for a project.

    Business workflow:
    - Pre-baseline commercial entity discussed with the customer.
    - Revised by version/status lifecycle until customer approval.
    - First approved estimate seeds project contract values (original + current).

    Current policy:
    - Plain English: this is the proposal the customer reviews/approves.
    - `title` is the family identifier for versioned estimates within a project.
    - `title` is required by API contract and treated as immutable after create.
    - Commercial values (tax/line items/totals) are locked once status leaves `draft`.
    - `public_token` powers read-only public estimate sharing links.
    - `void` is explicit user cancellation; `archived` is internal superseded-history state.
    - Lifecycle control: `user-managed` with status/value lock rules after send.
    - Visibility: `customer-facing` artifact (with internal workflow controls).
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        # User-driven cancellation/withdrawal state.
        VOID = "void", "Void"
        # System-controlled lifecycle state for superseded historical versions.
        ARCHIVED = "archived", "Archived"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    # Example: `draft -> sent` is allowed because
    # `Status.SENT` is in `ALLOWED_STATUS_TRANSITIONS[Status.DRAFT]`.
    _status_label = "estimate"

    ALLOWED_STATUS_TRANSITIONS = {
        Status.DRAFT: {Status.SENT, Status.VOID, Status.ARCHIVED},
        Status.SENT: {
            # Explicitly allow re-send to capture repeat sends as auditable events.
            Status.SENT,
            Status.APPROVED,
            Status.REJECTED,
            Status.VOID,
            Status.ARCHIVED,
        },
        Status.APPROVED: set(),
        Status.REJECTED: {Status.VOID},
        Status.VOID: set(),
        Status.ARCHIVED: set(),
    }

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="estimates",
    )
    # Family version is 1-based (v1 is the first estimate) and unique per
    # (project, title) estimate family.
    version = models.PositiveIntegerField()
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    title = models.CharField(max_length=255, blank=True)
    valid_through = models.DateField(null=True, blank=True)
    terms_text = models.TextField(blank=True, default="")
    sender_name = models.CharField(max_length=255, blank=True, default="")
    sender_address = models.TextField(blank=True, default="")
    sender_logo_url = models.URLField(blank=True, default="")
    public_token = models.CharField(max_length=24, unique=True, null=True, blank=True)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    markup_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="estimates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("project", "title", "version")

    def __str__(self) -> str:
        return f"{self.project.name} v{self.version}"

    @property
    def public_slug(self) -> str:
        """URL-safe slug derived from the estimate title."""
        normalized = slugify((self.title or "").strip())
        return normalized or "estimate"

    @property
    def public_ref(self) -> str:
        """Combined slug--token identifier for public sharing URLs."""
        return f"{self.public_slug}--{self.public_token}"

    def clean(self):
        """Validate status transitions before save."""
        errors = {}
        self.validate_status_transition(errors)
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        """Auto-generate public token if missing, then validate and persist."""
        if not self.public_token:
            while True:
                candidate = generate_public_token()
                if not Estimate.objects.filter(public_token=candidate).exists():
                    self.public_token = candidate
                    break
        self.full_clean()
        return super().save(*args, **kwargs)
