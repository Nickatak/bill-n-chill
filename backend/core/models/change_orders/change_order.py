"""ChangeOrder model — post-baseline contract delta request for scope, time, and cost changes."""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils.text import slugify

from core.models.mixins import StatusTransitionMixin
from core.utils.tokens import generate_public_token

User = get_user_model()


class ChangeOrder(StatusTransitionMixin, models.Model):
    """Post-baseline contract delta request for scope/time/cost changes.

    Business workflow:
    - Represents change governance after baseline, not a full estimate restart.
    - Routed through draft -> pending approval -> approved/rejected/void lifecycle.
    - Approved amount deltas propagate to project contract value.

    Current policy:
    - Lifecycle control: `user-managed` with status-transition guards.
    - Visibility: `internal-facing` workflow artifact that may drive customer-facing communication.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PENDING_APPROVAL = "pending_approval", "Pending Approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        VOID = "void", "Void"

    # Transition-map format:
    # {from_status: {allowed_to_status_1, allowed_to_status_2, ...}}
    # Example: `draft -> pending_approval` is allowed because
    # `Status.PENDING_APPROVAL` is in `ALLOWED_STATUS_TRANSITIONS[Status.DRAFT]`.
    _status_label = "change-order"

    ALLOWED_STATUS_TRANSITIONS = {
        Status.DRAFT: {
            Status.PENDING_APPROVAL,
            Status.VOID,
        },
        Status.PENDING_APPROVAL: {
            Status.APPROVED,
            Status.REJECTED,
            Status.VOID,
        },
        Status.APPROVED: set(),
        Status.REJECTED: {
            Status.VOID,
        },
        Status.VOID: set(),
    }

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="change_orders",
    )
    # Stable family/thread identifier across revisions within a project.
    # Intended as a semantic key (not DB/FK id) and may be numeric or string.
    family_key = models.CharField(max_length=64)
    revision_number = models.PositiveIntegerField(default=1)
    title = models.CharField(max_length=255)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    public_token = models.CharField(max_length=24, unique=True, null=True, blank=True)
    amount_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    days_delta = models.IntegerField(default=0)
    reason = models.TextField(blank=True)
    terms_text = models.TextField(blank=True, default="")
    origin_estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.PROTECT,
        related_name="originated_change_orders",
        null=True,
        blank=True,
    )
    # Explicit parent revision pointer.
    # This relationship is derivable from (`family_key`, `revision_number - 1`),
    # but stored directly for audit/replay clarity and parent-chain integrity.
    previous_change_order = models.ForeignKey(
        "ChangeOrder",
        on_delete=models.PROTECT,
        related_name="revision_children",
        null=True,
        blank=True,
    )
    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="requested_change_orders",
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="approved_change_orders",
        null=True,
        blank=True,
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("project", "family_key", "revision_number")
        constraints = [
            models.CheckConstraint(
                condition=Q(status="approved", approved_by__isnull=False, approved_at__isnull=False)
                | ~Q(status="approved"),
                name="co_approved_requires_actor_and_timestamp",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "family_key"], name="core_changeo_proj_fam_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.project.name} CO-{self.family_key} v{self.revision_number}"

    @property
    def public_slug(self) -> str:
        """URL-safe slug derived from family key and revision number."""
        normalized = slugify(f"co-{self.family_key}-v{self.revision_number}")
        return normalized or "change-order"

    @property
    def public_ref(self) -> str:
        """Combined slug--token identifier for public sharing URLs."""
        if not self.public_token:
            return ""
        return f"{self.public_slug}--{self.public_token}"

    def clean(self):
        """Validate approval fields, origin estimate, revision chain, and status transitions."""
        from core.models.estimating.estimate import Estimate

        errors = {}

        if self.status == self.Status.APPROVED:
            if self.approved_by_id is None:
                errors.setdefault("approved_by", []).append(
                    "approved_by is required when status is approved."
                )
            if self.approved_at is None:
                errors.setdefault("approved_at", []).append(
                    "approved_at is required when status is approved."
                )
        else:
            if self.approved_by_id is not None:
                errors.setdefault("approved_by", []).append(
                    "approved_by must be empty unless status is approved."
                )
            if self.approved_at is not None:
                errors.setdefault("approved_at", []).append(
                    "approved_at must be empty unless status is approved."
                )

        if self.origin_estimate_id is not None:
            origin_project_id = (
                Estimate.objects.filter(id=self.origin_estimate_id).values_list("project_id", flat=True).first()
            )
            if origin_project_id is None:
                errors.setdefault("origin_estimate", []).append(
                    "origin_estimate does not exist."
                )
            elif self.project_id and origin_project_id != self.project_id:
                errors.setdefault("origin_estimate", []).append(
                    "origin_estimate must belong to the same project."
                )

        if self.revision_number > 1 and self.previous_change_order_id is None:
            errors.setdefault("previous_change_order", []).append(
                "previous_change_order is required when revision_number is greater than 1."
            )
        if self.previous_change_order_id is not None:
            previous_row = (
                type(self)
                .objects.filter(id=self.previous_change_order_id)
                .values("project_id", "family_key", "revision_number")
                .first()
            )
            if previous_row is None:
                errors.setdefault("previous_change_order", []).append(
                    "previous_change_order does not exist."
                )
            else:
                if self.project_id and previous_row["project_id"] != self.project_id:
                    errors.setdefault("previous_change_order", []).append(
                        "previous_change_order must belong to the same project."
                    )
                if self.family_key and previous_row["family_key"] != self.family_key:
                    errors.setdefault("family_key", []).append(
                        "family_key must match previous_change_order family."
                    )
                expected_revision = previous_row["revision_number"] + 1
                if self.revision_number != expected_revision:
                    errors.setdefault("revision_number", []).append(
                        f"revision_number must be {expected_revision} for this previous_change_order."
                    )

        self.validate_status_transition(errors)

        if errors:
            raise ValidationError(errors)

    def build_snapshot(self) -> dict:
        """Point-in-time snapshot for immutable audit records."""
        from core.models.estimating.estimate import Estimate

        origin_estimate_version = None
        if self.origin_estimate_id is not None:
            origin_estimate_version = (
                Estimate.objects.filter(id=self.origin_estimate_id)
                .values_list("version", flat=True)
                .first()
            )

        line_rows = list(
            self.line_items.select_related("cost_code").order_by("id")
        )

        def _line_snapshot(row):
            if row.cost_code_id:
                cc_id = row.cost_code_id
                cc_code = row.cost_code.code
                cc_name = row.cost_code.name
            else:
                cc_id = cc_code = cc_name = None
            return {
                "change_order_line_id": row.id,
                "cost_code_id": cc_id,
                "cost_code_code": cc_code,
                "cost_code_name": cc_name,
                "description": row.description,
                "adjustment_reason": row.adjustment_reason,
                "amount_delta": str(row.amount_delta),
                "days_delta": row.days_delta,
            }

        return {
            "change_order": {
                "id": self.id,
                "project_id": self.project_id,
                "family_key": self.family_key,
                "revision_number": self.revision_number,
                "title": self.title,
                "status": self.status,
                "amount_delta": str(self.amount_delta),
                "days_delta": self.days_delta,
                "reason": self.reason,
                "terms_text": self.terms_text,
                "origin_estimate_id": self.origin_estimate_id,
                "origin_estimate_version": origin_estimate_version,
                "previous_change_order_id": self.previous_change_order_id,
                "approved_by_id": self.approved_by_id,
                "approved_at": self.approved_at.isoformat() if self.approved_at else None,
            },
            "line_items": [_line_snapshot(row) for row in line_rows],
        }

    def save(self, *args, **kwargs):
        """Auto-generate public token if missing, then validate and persist."""
        update_fields = kwargs.get("update_fields")
        if not self.public_token:
            while True:
                candidate = generate_public_token()
                if not type(self).objects.filter(public_token=candidate).exists():
                    self.public_token = candidate
                    break
            if update_fields is not None:
                update_fields_set = set(update_fields)
                update_fields_set.add("public_token")
                kwargs["update_fields"] = list(update_fields_set)
        self.full_clean()
        return super().save(*args, **kwargs)
