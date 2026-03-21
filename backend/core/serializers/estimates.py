"""Estimate serializers for read, write, duplication, and status-event representations."""

from decimal import Decimal

from rest_framework import serializers

from core.models import Estimate, EstimateLineItem, EstimateStatusEvent
from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display


def _estimate_customer(obj):
    """Return the customer associated with the status event's estimate project."""
    return getattr(getattr(getattr(obj, "estimate", None), "project", None), "customer", None)


class EstimateLineItemSerializer(serializers.ModelSerializer):
    """Read-only estimate line item with cost code details."""

    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)

    class Meta:
        model = EstimateLineItem
        fields = [
            "id",
            "estimate",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "quantity",
            "unit",
            "unit_price",
            "markup_percent",
            "line_total",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "line_total", "created_at", "updated_at"]


class EstimateSerializer(serializers.ModelSerializer):
    """Read-only estimate with nested line items."""

    line_items = EstimateLineItemSerializer(many=True, read_only=True)
    public_ref = serializers.CharField(read_only=True)

    class Meta:
        model = Estimate
        fields = [
            "id",
            "project",
            "version",
            "status",
            "title",
            "valid_through",
            "terms_text",
            "sender_name",
            "sender_address",
            "sender_logo_url",
            "subtotal",
            "markup_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "public_ref",
            "line_items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "version",
            "sender_name",
            "sender_address",
            "sender_logo_url",
            "subtotal",
            "markup_total",
            "tax_total",
            "grand_total",
            "line_items",
            "created_at",
            "updated_at",
        ]


class EstimateStatusEventSerializer(serializers.ModelSerializer):
    """Read-only estimate status event with computed action type and actor display."""

    changed_by_email = serializers.CharField(source="changed_by.email", read_only=True)
    changed_by_display = serializers.SerializerMethodField()
    changed_by_customer_id = serializers.SerializerMethodField()
    action_type = serializers.SerializerMethodField()

    def get_action_type(self, obj: EstimateStatusEvent) -> str:
        """Classify the event as create, transition, resend, notate, or unchanged."""
        from_status = obj.from_status or ""
        to_status = obj.to_status or ""
        note = (obj.note or "").strip()
        if not from_status:
            return "create"
        if from_status != to_status:
            return "transition"
        if to_status == Estimate.Status.SENT and note.lower() in {"", "estimate re-sent."}:
            return "resend"
        if note:
            return "notate"
        return "unchanged"

    def get_changed_by_display(self, obj: EstimateStatusEvent) -> str:
        """Return a human-readable display name for the actor who changed the status."""
        return resolve_public_actor_display(obj, actor_field="changed_by", customer_fn=_estimate_customer)

    def get_changed_by_customer_id(self, obj: EstimateStatusEvent):
        """Return the customer ID if the actor acted via a public token."""
        return resolve_public_actor_customer_id(obj, customer_fn=_estimate_customer)

    class Meta:
        model = EstimateStatusEvent
        fields = [
            "id",
            "estimate",
            "from_status",
            "to_status",
            "note",
            "changed_by",
            "changed_by_email",
            "changed_by_display",
            "changed_by_customer_id",
            "changed_at",
            "action_type",
        ]
        read_only_fields = fields


class EstimateLineItemInputSerializer(serializers.Serializer):
    """Write serializer for a single estimate line item in a create/update payload."""

    cost_code = serializers.IntegerField()
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=2)
    unit = serializers.CharField(max_length=30, required=False, default="ea")
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    markup_percent = serializers.DecimalField(
        max_digits=6, decimal_places=2, required=False, default=Decimal("0")
    )


class EstimateWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating an estimate with line items."""

    title = serializers.CharField(max_length=255, required=True, allow_blank=False)
    allow_existing_title_family = serializers.BooleanField(required=False, default=False)
    status = serializers.ChoiceField(choices=Estimate.Status.choices, required=False)
    status_note = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    valid_through = serializers.DateField(required=False, allow_null=True)
    terms_text = serializers.CharField(max_length=10000, required=False, allow_blank=True)
    tax_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    line_items = EstimateLineItemInputSerializer(many=True, required=False)

    def validate_title(self, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError("Title cannot be blank.")
        return trimmed

    def validate_status(self, value: str) -> str:
        if value == Estimate.Status.ARCHIVED:
            raise serializers.ValidationError(
                "Archived status is system-controlled and cannot be set directly."
            )
        return value


class EstimateDuplicateSerializer(serializers.Serializer):
    """Write serializer for duplicating an estimate to the same or different project."""

    project_id = serializers.IntegerField(required=False)
    title = serializers.CharField(max_length=255, required=True, allow_blank=False)

    def validate_title(self, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError("Title cannot be blank.")
        return trimmed
