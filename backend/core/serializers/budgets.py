from decimal import Decimal

from rest_framework import serializers

from core.models import Budget, BudgetLine


class BudgetLineSerializer(serializers.ModelSerializer):
    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)
    planned_amount = serializers.SerializerMethodField()
    actual_spend = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()

    class Meta:
        model = BudgetLine
        fields = [
            "id",
            "budget",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "budget_amount",
            "planned_amount",
            "actual_spend",
            "remaining_amount",
            "committed_amount",
            "actual_amount",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "budget",
            "cost_code_code",
            "cost_code_name",
            "created_at",
            "updated_at",
        ]

    def get_planned_amount(self, obj):
        return str(obj.budget_amount or Decimal("0"))

    def get_actual_spend(self, obj):
        spend_map = self.context.get("line_actual_spend_map", {})
        return str(spend_map.get(obj.id, Decimal("0")))

    def get_remaining_amount(self, obj):
        spend_map = self.context.get("line_actual_spend_map", {})
        actual_spend = spend_map.get(obj.id, Decimal("0"))
        planned_amount = obj.budget_amount or Decimal("0")
        return str(planned_amount - actual_spend)


class BudgetSerializer(serializers.ModelSerializer):
    source_estimate_version = serializers.IntegerField(source="source_estimate.version", read_only=True)
    line_items = BudgetLineSerializer(many=True, read_only=True)
    base_working_total = serializers.SerializerMethodField()
    current_working_total = serializers.SerializerMethodField()

    class Meta:
        model = Budget
        fields = [
            "id",
            "project",
            "status",
            "source_estimate",
            "source_estimate_version",
            "baseline_snapshot_json",
            "approved_change_order_total",
            "base_working_total",
            "current_working_total",
            "line_items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_base_working_total(self, obj):
        total = sum((line.budget_amount for line in obj.line_items.all()), Decimal("0"))
        return str(total)

    def get_current_working_total(self, obj):
        base_total = sum((line.budget_amount for line in obj.line_items.all()), Decimal("0"))
        return str(base_total + obj.approved_change_order_total)


class BudgetLineUpdateSerializer(serializers.Serializer):
    description = serializers.CharField(max_length=255, required=False, allow_blank=False)
    budget_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
