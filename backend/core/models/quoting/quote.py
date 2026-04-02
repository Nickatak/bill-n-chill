"""Quote model — mutable operational record for customer-facing project cost proposals."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.text import slugify

from core.models.mixins import StatusTransitionMixin
from core.utils.tokens import generate_public_token

User = get_user_model()


class Quote(StatusTransitionMixin, models.Model):
    """Customer-facing scope and price proposal for a project.

    Business workflow:
    - Pre-baseline commercial entity discussed with the customer.
    - Revised by version/status lifecycle until customer approval.
    - First approved quote seeds project contract values (original + current).

    Current policy:
    - Plain English: this is the proposal the customer reviews/approves.
    - `title` is the family identifier for versioned quotes within a project.
    - `title` is required by API contract and treated as immutable after create.
    - Commercial values (tax/line items/totals) are locked once status leaves `draft`.
    - `public_token` powers read-only public quote sharing links.
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
    _status_label = "quote"

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
        related_name="quotes",
    )
    # Family version is 1-based (v1 is the first quote) and unique per
    # (project, title) quote family.
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
    notes_text = models.TextField(blank=True, default="")
    sender_name = models.CharField(max_length=255, blank=True, default="")
    sender_address = models.TextField(blank=True, default="")
    sender_logo_url = models.URLField(blank=True, default="")
    public_token = models.CharField(max_length=24, unique=True, null=True, blank=True)
    contract_pdf = models.FileField(upload_to="contracts/quotes/", blank=True, default="")
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    markup_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    contingency_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    contingency_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    overhead_profit_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    overhead_profit_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    insurance_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    insurance_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_percent = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="quotes",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "title", "version"],
                name="unique_quote_title_version_per_project",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} v{self.version}"

    @property
    def public_slug(self) -> str:
        """URL-safe slug derived from the quote title."""
        normalized = slugify((self.title or "").strip())
        return normalized or "quote"

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
            # 24-char token space makes collisions near-impossible; bounded
            # loop is a safeguard so a broken generator can't hang save().
            for _ in range(10):
                candidate = generate_public_token()
                if not Quote.objects.filter(public_token=candidate).exists():
                    self.public_token = candidate
                    break
            else:
                raise RuntimeError("Failed to generate unique public token after 10 attempts")
        self.full_clean()
        return super().save(*args, **kwargs)
