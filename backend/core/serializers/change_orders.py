from decimal import Decimal

from django.db.models import Sum
from rest_framework import serializers

from core.models import ChangeOrder, ChangeOrderLine


class ChangeOrderLineSerializer(serializers.ModelSerializer):
    budget_line_cost_code = serializers.CharField(source="budget_line.cost_code.code", read_only=True)
    budget_line_description = serializers.CharField(source="budget_line.description", read_only=True)

    class Meta:
        model = ChangeOrderLine
        fields = [
            "id",
            "change_order",
            "budget_line",
            "budget_line_cost_code",
            "budget_line_description",
            "description",
            "amount_delta",
            "days_delta",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "change_order", "created_at", "updated_at"]


class ChangeOrderSerializer(serializers.ModelSerializer):
    requested_by_email = serializers.EmailField(source="requested_by.email", read_only=True)
    approved_by_email = serializers.EmailField(source="approved_by.email", read_only=True)
    line_items = ChangeOrderLineSerializer(many=True, read_only=True)
    line_total_delta = serializers.SerializerMethodField()
    is_latest_revision = serializers.SerializerMethodField()

    def get_is_latest_revision(self, obj) -> bool:
        return not ChangeOrder.objects.filter(
            project=obj.project,
            family_key=obj.family_key,
            revision_number__gt=obj.revision_number,
        ).exists()

    def get_line_total_delta(self, obj) -> str:
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
            "amount_delta",
            "days_delta",
            "reason",
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
    budget_line = serializers.IntegerField()
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    amount_delta = serializers.DecimalField(max_digits=12, decimal_places=2)
    days_delta = serializers.IntegerField(required=False, default=0)


class ChangeOrderWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, allow_blank=False)
    status = serializers.ChoiceField(choices=ChangeOrder.Status.choices, required=False)
    amount_delta = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    days_delta = serializers.IntegerField(required=False)
    reason = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    line_items = ChangeOrderLineInputSerializer(many=True, required=False)
    origin_estimate = serializers.IntegerField(required=False, allow_null=True)
