"""Budget and budget line serializers with computed financial rollup fields."""

from decimal import Decimal

from rest_framework import serializers

from core.models import Budget, BudgetLine
from core.utils.money import quantize_money


class BudgetLineSerializer(serializers.ModelSerializer):
    """Read-only budget line with computed spend, change order, and billing rollups."""

    scope_item = serializers.IntegerField(source="scope_item_id", read_only=True)
    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)
    planned_amount = serializers.SerializerMethodField()
    actual_spend = serializers.SerializerMethodField()
    approved_change_order_delta = serializers.SerializerMethodField()
    current_working_amount = serializers.SerializerMethodField()
    remaining_amount = serializers.SerializerMethodField()
    billed_to_date = serializers.SerializerMethodField()
    remaining_billable = serializers.SerializerMethodField()

    class Meta:
        model = BudgetLine
        fields = [
            "id",
            "budget",
            "scope_item",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "budget_amount",
            "planned_amount",
            "actual_spend",
            "approved_change_order_delta",
            "current_working_amount",
            "remaining_amount",
            "billed_to_date",
            "remaining_billable",
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

    @staticmethod
    def _money_str(value) -> str:
        return str(quantize_money(value or 0))

    def get_planned_amount(self, obj):
        """Return the original budget amount as a decimal string."""
        return str(obj.budget_amount or Decimal("0"))

    def get_actual_spend(self, obj):
        """Return the actual vendor bill spend allocated to this line."""
        spend_map = self.context.get("line_actual_spend_map", {})
        return self._money_str(spend_map.get(obj.id, Decimal("0")))

    def get_approved_change_order_delta(self, obj):
        """Return the net approved change order delta for this line."""
        co_delta_map = self.context.get("line_approved_co_delta_map", {})
        return self._money_str(co_delta_map.get(obj.id, Decimal("0")))

    def get_current_working_amount(self, obj):
        """Return the budget amount plus approved change order deltas."""
        co_delta_map = self.context.get("line_approved_co_delta_map", {})
        base_amount = obj.budget_amount or Decimal("0")
        return self._money_str(base_amount + co_delta_map.get(obj.id, Decimal("0")))

    def get_remaining_amount(self, obj):
        """Return current working amount minus actual spend."""
        spend_map = self.context.get("line_actual_spend_map", {})
        actual_spend = spend_map.get(obj.id, Decimal("0"))
        co_delta_map = self.context.get("line_approved_co_delta_map", {})
        planned_amount = (obj.budget_amount or Decimal("0")) + co_delta_map.get(obj.id, Decimal("0"))
        return self._money_str(planned_amount - actual_spend)

    def get_billed_to_date(self, obj):
        """Return the total invoiced amount for this line."""
        billed_map = self.context.get("line_billed_to_date_map", {})
        return self._money_str(billed_map.get(obj.id, Decimal("0")))

    def get_remaining_billable(self, obj):
        """Return current working amount minus billed-to-date."""
        co_delta_map = self.context.get("line_approved_co_delta_map", {})
        current_working = (obj.budget_amount or Decimal("0")) + co_delta_map.get(obj.id, Decimal("0"))
        billed_map = self.context.get("line_billed_to_date_map", {})
        billed = billed_map.get(obj.id, Decimal("0"))
        return self._money_str(current_working - billed)


class BudgetSerializer(serializers.ModelSerializer):
    """Read-only budget with nested line items and working total rollups."""

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
        """Return the sum of all line budget amounts before change orders."""
        total = sum((line.budget_amount for line in obj.line_items.all()), Decimal("0"))
        return str(total)

    def get_current_working_total(self, obj):
        """Return the base working total plus approved change order adjustments."""
        base_total = sum((line.budget_amount for line in obj.line_items.all()), Decimal("0"))
        return str(base_total + obj.approved_change_order_total)


class BudgetLineUpdateSerializer(serializers.Serializer):
    """Write serializer for updating a budget line's description or amount."""

    description = serializers.CharField(max_length=255, required=False, allow_blank=False)
    budget_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
