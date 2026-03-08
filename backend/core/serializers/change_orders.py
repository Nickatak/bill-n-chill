"""Change order serializers for read, write, and line item representations."""

from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers

from core.models import ChangeOrder, ChangeOrderLine


class ChangeOrderLineSerializer(serializers.ModelSerializer):
    """Read-only change order line item with budget/cost code details."""

    budget_line_cost_code = serializers.SerializerMethodField()
    budget_line_description = serializers.SerializerMethodField()
    cost_code_id = serializers.SerializerMethodField()
    cost_code_code = serializers.SerializerMethodField()
    cost_code_name = serializers.SerializerMethodField()

    def get_budget_line_cost_code(self, obj) -> str | None:
        if obj.budget_line_id and obj.budget_line:
            return obj.budget_line.cost_code.code
        return None

    def get_budget_line_description(self, obj) -> str | None:
        if obj.budget_line_id and obj.budget_line:
            return obj.budget_line.description
        return None

    def get_cost_code_id(self, obj) -> int | None:
        """Return the effective cost code ID (from budget line or direct FK)."""
        if obj.budget_line_id and obj.budget_line:
            return obj.budget_line.cost_code_id
        if obj.cost_code_id:
            return obj.cost_code_id
        return None

    def get_cost_code_code(self, obj) -> str | None:
        if obj.budget_line_id and obj.budget_line:
            return obj.budget_line.cost_code.code
        if obj.cost_code_id and obj.cost_code:
            return obj.cost_code.code
        return None

    def get_cost_code_name(self, obj) -> str | None:
        if obj.budget_line_id and obj.budget_line:
            return obj.budget_line.cost_code.name
        if obj.cost_code_id and obj.cost_code:
            return obj.cost_code.name
        return None

    class Meta:
        model = ChangeOrderLine
        fields = [
            "id",
            "change_order",
            "budget_line",
            "budget_line_cost_code",
            "budget_line_description",
            "cost_code",
            "cost_code_id",
            "cost_code_code",
            "cost_code_name",
            "description",
            "line_type",
            "adjustment_reason",
            "amount_delta",
            "days_delta",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "change_order", "created_at", "updated_at"]


class ChangeOrderSerializer(serializers.ModelSerializer):
    """Read-only change order with nested line items and revision context."""

    requested_by_email = serializers.EmailField(source="requested_by.email", read_only=True)
    approved_by_email = serializers.EmailField(source="approved_by.email", read_only=True)
    public_ref = serializers.CharField(read_only=True)
    line_items = ChangeOrderLineSerializer(many=True, read_only=True)
    line_total_delta = serializers.SerializerMethodField()
    is_latest_revision = serializers.SerializerMethodField()

    def get_is_latest_revision(self, obj) -> bool:
        """Return whether this change order is the latest revision in its family."""
        latest_map = self.context.get("is_latest_revision_map")
        if latest_map is not None:
            return latest_map.get(obj.id, False)
        # Fallback for single-object detail views without precomputed context.
        return not ChangeOrder.objects.filter(
            project=obj.project,
            family_key=obj.family_key,
            revision_number__gt=obj.revision_number,
        ).exists()

    def get_line_total_delta(self, obj) -> str:
        """Return the sum of all line item amount deltas as a decimal string."""
        if not hasattr(obj, "_prefetched_objects_cache") or "line_items" not in obj._prefetched_objects_cache:
            return str(obj.line_items.all().aggregate(total=Sum("amount_delta")).get("total") or Decimal("0.00"))
        return str(sum((line.amount_delta for line in obj.line_items.all()), Decimal("0.00")))

    class Meta:
        model = ChangeOrder
        fields = [
            "id",
            "project",
            "family_key",
            "revision_number",
            "title",
            "status",
            "public_ref",
            "amount_delta",
            "days_delta",
            "reason",
            "terms_text",
            "origin_estimate",
            "previous_change_order",
            "requested_by",
            "requested_by_email",
            "approved_by",
            "approved_by_email",
            "approved_at",
            "line_items",
            "line_total_delta",
            "is_latest_revision",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "family_key",
            "revision_number",
            "previous_change_order",
            "requested_by",
            "requested_by_email",
            "approved_by",
            "approved_by_email",
            "approved_at",
            "line_items",
            "line_total_delta",
            "is_latest_revision",
            "created_at",
            "updated_at",
        ]


class ChangeOrderLineInputSerializer(serializers.Serializer):
    """Write serializer for a single change order line item in a create/update payload."""

    line_type = serializers.ChoiceField(
        choices=ChangeOrderLine.LineType.choices,
        required=False,
        default=ChangeOrderLine.LineType.ORIGINAL,
    )
    budget_line = serializers.IntegerField(required=False, allow_null=True, default=None)
    cost_code = serializers.IntegerField(required=False, allow_null=True, default=None)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    adjustment_reason = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default="",
    )
    amount_delta = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_delta = serializers.IntegerField(required=False, default=0)


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
    origin_estimate = serializers.IntegerField(required=False, allow_null=True)
