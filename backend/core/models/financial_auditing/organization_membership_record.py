from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import models

User = get_user_model()


ORG_MEMBERSHIP_STATUS_CHOICES = [
    ("active", "Active"),
    ("disabled", "Disabled"),
]

ORG_MEMBERSHIP_ROLE_CHOICES = [
    ("owner", "Owner"),
    ("pm", "Project Manager"),
    ("worker", "Worker"),
    ("bookkeeping", "Bookkeeping"),
    ("viewer", "Viewer"),
]


class OrganizationMembershipRecord(models.Model):
    """Immutable audit capture for membership lifecycle and role changes.

    Business workflow:
    - Captures append-only membership events (bootstrap creation, status/role updates).
    - Preserves actor/source metadata for RBAC, compliance, and incident forensics.
    - Stores point-in-time membership snapshot payload for replay.

    Current policy:
    - Lifecycle control: `system-managed` append-only capture model.
    - Visibility: `internal-facing`.
    """

    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        STATUS_CHANGED = "status_changed", "Status Changed"
        ROLE_CHANGED = "role_changed", "Role Changed"
        ROLE_TEMPLATE_CHANGED = "role_template_changed", "Role Template Changed"
        CAPABILITY_FLAGS_UPDATED = "capability_flags_updated", "Capability Flags Updated"

    class CaptureSource(models.TextChoices):
        AUTH_BOOTSTRAP = "auth_bootstrap", "Auth Bootstrap"
        MANUAL_UI = "manual_ui", "Manual UI"
        MANUAL_API = "manual_api", "Manual API"
        SYSTEM = "system", "System"

    class OrganizationMembershipRecordQuerySet(models.QuerySet):
        def delete(self):
            raise ValidationError(
                "Organization membership records are immutable and cannot be deleted."
            )

    objects = OrganizationMembershipRecordQuerySet.as_manager()

    organization = models.ForeignKey(
        "Organization",
        on_delete=models.PROTECT,
        related_name="organization_membership_records",
    )
    organization_membership = models.ForeignKey(
        "OrganizationMembership",
        on_delete=models.SET_NULL,
        related_name="records",
        null=True,
        blank=True,
    )
    membership_user = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="membership_subject_records",
    )
    event_type = models.CharField(
        max_length=32,
        choices=EventType.choices,
    )
    capture_source = models.CharField(
        max_length=32,
        choices=CaptureSource.choices,
    )
    source_reference = models.CharField(max_length=128, blank=True, default="")
    from_status = models.CharField(
        max_length=32,
        choices=ORG_MEMBERSHIP_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    to_status = models.CharField(
        max_length=32,
        choices=ORG_MEMBERSHIP_STATUS_CHOICES,
        null=True,
        blank=True,
    )
    from_role = models.CharField(
        max_length=32,
        choices=ORG_MEMBERSHIP_ROLE_CHOICES,
        blank=True,
        default="",
    )
    to_role = models.CharField(
        max_length=32,
        choices=ORG_MEMBERSHIP_ROLE_CHOICES,
        blank=True,
        default="",
    )
    note = models.TextField(blank=True, default="")
    snapshot_json = models.JSONField(default=dict)
    metadata_json = models.JSONField(default=dict)
    recorded_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="recorded_organization_membership_records",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError(
                "Organization membership records are immutable and cannot be updated."
            )
        return super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError("Organization membership records are immutable and cannot be deleted.")

    def __str__(self) -> str:
        return (
            f"ORG-MEMBER-{self.organization_membership_id or 'na'} "
            f"{self.event_type} ({self.membership_user_id})"
        )
