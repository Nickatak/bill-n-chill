from rest_framework import serializers

from core.models import CostCode, Project


class ProjectSerializer(serializers.ModelSerializer):
    customer_display_name = serializers.CharField(source="customer.display_name", read_only=True)
    customer_billing_address = serializers.CharField(source="customer.billing_address", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "customer",
            "customer_display_name",
            "customer_billing_address",
            "name",
            "site_address",
            "status",
            "contract_value_original",
            "contract_value_current",
            "start_date_planned",
            "end_date_planned",
            "created_at",
        ]


class ProjectProfileSerializer(serializers.ModelSerializer):
    customer_display_name = serializers.CharField(source="customer.display_name", read_only=True)
    customer_billing_address = serializers.CharField(source="customer.billing_address", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "customer",
            "customer_display_name",
            "customer_billing_address",
            "name",
            "site_address",
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
            "customer_billing_address",
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


class PortfolioProjectSnapshotSerializer(serializers.Serializer):
    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    project_status = serializers.CharField()
    ar_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    ap_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    approved_change_orders_total = serializers.DecimalField(max_digits=12, decimal_places=2)


class PortfolioSnapshotSerializer(serializers.Serializer):
    generated_at = serializers.DateTimeField()
    date_filter = serializers.JSONField()
    active_projects_count = serializers.IntegerField()
    ar_total_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    ap_total_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    overdue_invoice_count = serializers.IntegerField()
    overdue_vendor_bill_count = serializers.IntegerField()
    projects = PortfolioProjectSnapshotSerializer(many=True)


class ChangeImpactProjectSerializer(serializers.Serializer):
    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    approved_change_order_count = serializers.IntegerField()
    approved_change_order_total = serializers.DecimalField(max_digits=12, decimal_places=2)


class ChangeImpactSummarySerializer(serializers.Serializer):
    generated_at = serializers.DateTimeField()
    date_filter = serializers.JSONField()
    approved_change_order_count = serializers.IntegerField()
    approved_change_order_total = serializers.DecimalField(max_digits=12, decimal_places=2)
    projects = ChangeImpactProjectSerializer(many=True)


class AttentionFeedItemSerializer(serializers.Serializer):
    kind = serializers.CharField()
    severity = serializers.CharField()
    label = serializers.CharField()
    detail = serializers.CharField()
    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    ui_route = serializers.CharField()
    detail_endpoint = serializers.CharField()
    due_date = serializers.DateField(allow_null=True)


class AttentionFeedSerializer(serializers.Serializer):
    generated_at = serializers.DateTimeField()
    due_soon_window_days = serializers.IntegerField()
    item_count = serializers.IntegerField()
    items = AttentionFeedItemSerializer(many=True)


class QuickJumpItemSerializer(serializers.Serializer):
    kind = serializers.CharField()
    record_id = serializers.IntegerField()
    label = serializers.CharField()
    sub_label = serializers.CharField()
    project_id = serializers.IntegerField(allow_null=True)
    project_name = serializers.CharField(allow_blank=True)
    ui_href = serializers.CharField()
    detail_endpoint = serializers.CharField()


class QuickJumpSearchSerializer(serializers.Serializer):
    query = serializers.CharField()
    item_count = serializers.IntegerField()
    items = QuickJumpItemSerializer(many=True)


class ProjectTimelineItemSerializer(serializers.Serializer):
    timeline_id = serializers.CharField()
    category = serializers.ChoiceField(choices=["financial", "workflow"])
    event_type = serializers.CharField()
    occurred_at = serializers.DateTimeField()
    label = serializers.CharField()
    detail = serializers.CharField(allow_blank=True)
    object_type = serializers.CharField()
    object_id = serializers.IntegerField()
    ui_route = serializers.CharField()
    detail_endpoint = serializers.CharField()


class ProjectTimelineSerializer(serializers.Serializer):
    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    category = serializers.ChoiceField(choices=["all", "financial", "workflow"])
    item_count = serializers.IntegerField()
    items = ProjectTimelineItemSerializer(many=True)
