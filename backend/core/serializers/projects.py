from rest_framework import serializers

from core.models import CostCode, Project


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = [
            "id",
            "customer",
            "name",
            "status",
            "contract_value_original",
            "contract_value_current",
            "start_date_planned",
            "end_date_planned",
            "created_at",
        ]


class ProjectProfileSerializer(serializers.ModelSerializer):
    customer_display_name = serializers.CharField(source="customer.display_name", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "customer",
            "customer_display_name",
            "name",
            "status",
            "contract_value_original",
            "contract_value_current",
            "start_date_planned",
            "end_date_planned",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "customer",
            "customer_display_name",
            "created_at",
        ]


class CostCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostCode
        fields = ["id", "code", "name", "is_active", "created_at", "updated_at"]


class ProjectFinancialSummarySerializer(serializers.Serializer):
    project_id = serializers.IntegerField()
    contract_value_original = serializers.DecimalField(max_digits=12, decimal_places=2)
    contract_value_current = serializers.DecimalField(max_digits=12, decimal_places=2)
    approved_change_orders_total = serializers.DecimalField(max_digits=12, decimal_places=2)
    invoiced_to_date = serializers.DecimalField(max_digits=12, decimal_places=2)
    paid_to_date = serializers.DecimalField(max_digits=12, decimal_places=2)
    ar_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    ap_total = serializers.DecimalField(max_digits=12, decimal_places=2)
    ap_paid = serializers.DecimalField(max_digits=12, decimal_places=2)
    ap_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    inbound_unapplied_credit = serializers.DecimalField(max_digits=12, decimal_places=2)
    outbound_unapplied_credit = serializers.DecimalField(max_digits=12, decimal_places=2)
    traceability = serializers.JSONField()
