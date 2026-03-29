"""Change order serializers for read, write, and line item representations."""

from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers

from core.models import ChangeOrder, ChangeOrderLine, ChangeOrderSection, ChangeOrderStatusEvent
from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display


class ChangeOrderLineSerializer(serializers.ModelSerializer):
    """Read-only change order line item with cost code details."""

    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)

    class Meta:
        model = ChangeOrderLine
        fields = [
            "id",
            "change_order",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "adjustment_reason",
            "amount_delta",
            "days_delta",
            "order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "change_order", "created_at", "updated_at"]


class ChangeOrderSectionSerializer(serializers.ModelSerializer):
    """Read-only change order section with stored subtotal."""

    class Meta:
        model = ChangeOrderSection
        fields = [
            "id",
            "name",
            "order",
            "subtotal",
        ]


class ChangeOrderSerializer(serializers.ModelSerializer):
    """Read-only change order with nested line items."""

    requested_by_email = serializers.EmailField(source="requested_by.email", read_only=True)
    approved_by_email = serializers.EmailField(source="approved_by.email", read_only=True)
    public_ref = serializers.CharField(read_only=True)
    line_items = ChangeOrderLineSerializer(many=True, read_only=True)
    sections = ChangeOrderSectionSerializer(many=True, read_only=True)
    line_total_delta = serializers.SerializerMethodField()
    contract_pdf_url = serializers.SerializerMethodField()

    def get_line_total_delta(self, obj) -> str:
        """Return the sum of all line item amount deltas as a decimal string."""
        if not hasattr(obj, "_prefetched_objects_cache") or "line_items" not in obj._prefetched_objects_cache:
            return str(obj.line_items.all().aggregate(total=Sum("amount_delta")).get("total") or Decimal("0.00"))
        return str(sum((line.amount_delta for line in obj.line_items.all()), Decimal("0.00")))

    def get_contract_pdf_url(self, obj: ChangeOrder) -> str:
        """Return the absolute URL for the uploaded contract PDF, or empty string."""
        if not obj.contract_pdf:
            return ""
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.contract_pdf.url)
        return ""

    class Meta:
        model = ChangeOrder
        fields = [
            "id",
            "project",
            "family_key",
            "title",
            "status",
            "public_ref",
            "amount_delta",
            "days_delta",
            "reason",
            "terms_text",
            "sender_name",
            "sender_address",
            "sender_logo_url",
            "contract_pdf_url",
            "origin_estimate",
            "requested_by",
            "requested_by_email",
            "approved_by",
            "approved_by_email",
            "approved_at",
            "line_items",
            "sections",
            "line_total_delta",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "family_key",
            "sender_name",
            "sender_address",
            "sender_logo_url",
            "requested_by",
            "requested_by_email",
            "approved_by",
            "approved_by_email",
            "approved_at",
            "line_items",
            "sections",
            "line_total_delta",
            "created_at",
            "updated_at",
        ]


class ChangeOrderLineInputSerializer(serializers.Serializer):
    """Write serializer for a single change order line item in a create/update payload."""

    cost_code = serializers.IntegerField()
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    adjustment_reason = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default="",
    )
    amount_delta = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_delta = serializers.IntegerField(required=False, default=0)
    order = serializers.IntegerField(required=False, default=0)


class ChangeOrderSectionInputSerializer(serializers.Serializer):
    """Write serializer for a single change order section in a create/update payload."""

    name = serializers.CharField(max_length=200)
    order = serializers.IntegerField()


class ChangeOrderWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating a change order with line items."""

    title = serializers.CharField(max_length=255, required=False, allow_blank=False)
    status = serializers.ChoiceField(choices=ChangeOrder.Status.choices, required=False)
    status_note = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    amount_delta = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    days_delta = serializers.IntegerField(required=False)
    reason = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    terms_text = serializers.CharField(max_length=10000, required=False, allow_blank=True)
    line_items = ChangeOrderLineInputSerializer(many=True, required=False)
    sections = ChangeOrderSectionInputSerializer(many=True, required=False, default=[])
    origin_estimate = serializers.IntegerField(required=False, allow_null=True)


def _change_order_customer(obj: ChangeOrderStatusEvent):
    """Navigate from a CO status event to the associated Customer."""
    try:
        return obj.change_order.project.customer
    except AttributeError:
        return None


class ChangeOrderStatusEventSerializer(serializers.ModelSerializer):
    """Read-only CO status event with computed action type and actor display."""

    changed_by_email = serializers.CharField(source="changed_by.email", read_only=True)
    changed_by_display = serializers.SerializerMethodField()
    changed_by_customer_id = serializers.SerializerMethodField()
    action_type = serializers.SerializerMethodField()

    def get_action_type(self, obj: ChangeOrderStatusEvent) -> str:
        """Classify the event as create, transition, resend, notate, or unchanged."""
        from_status = obj.from_status or ""
        to_status = obj.to_status or ""
        note = (obj.note or "").strip()
        if not from_status:
            return "create"
        if from_status != to_status:
            return "transition"
        if to_status == ChangeOrder.Status.SENT and note.lower() in {"", "change order re-sent."}:
            return "resend"
        if note:
            return "notate"
        return "unchanged"

    def get_changed_by_display(self, obj: ChangeOrderStatusEvent) -> str:
        """Return a human-readable display name for the actor who changed the status."""
        return resolve_public_actor_display(obj, actor_field="changed_by", customer_fn=_change_order_customer)

    def get_changed_by_customer_id(self, obj: ChangeOrderStatusEvent):
        """Return the customer ID if the actor acted via a public token."""
        return resolve_public_actor_customer_id(obj, customer_fn=_change_order_customer)

    class Meta:
        model = ChangeOrderStatusEvent
        fields = [
            "id",
            "change_order",
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
