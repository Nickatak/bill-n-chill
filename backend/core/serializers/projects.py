"""Project, cost code, financial summary, portfolio, and dashboard serializers."""

from rest_framework import serializers

from core.models import CostCode, Project


class ProjectSerializer(serializers.ModelSerializer):
    """Read-only project representation with customer display fields."""

    customer_display_name = serializers.CharField(source="customer.display_name", read_only=True)
    customer_billing_address = serializers.CharField(source="customer.billing_address", read_only=True)
    customer_email = serializers.CharField(source="customer.email", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "customer",
            "customer_display_name",
            "customer_billing_address",
            "customer_email",
            "customer_phone",
            "name",
            "site_address",
            "status",
            "contract_value_original",
            "contract_value_current",
            "created_at",
        ]


class ProjectProfileSerializer(serializers.ModelSerializer):
    """Read/write project profile for editing name, address, status, and contract values."""

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
    """Read/write cost code representation."""

    def validate(self, attrs):
        if self.instance is None and attrs.get("is_active") is False:
            raise serializers.ValidationError(
                {"is_active": ["New cost codes must be active on creation."]}
            )
        return attrs

    class Meta:
        model = CostCode
        fields = ["id", "code", "name", "is_active", "taxable", "created_at", "updated_at"]


class ProjectFinancialSummarySerializer(serializers.Serializer):
    """Read-only financial summary for a single project with AR/AP breakdowns."""

    project_id = serializers.IntegerField()
    contract_value_original = serializers.DecimalField(max_digits=12, decimal_places=2)
    contract_value_current = serializers.DecimalField(max_digits=12, decimal_places=2)
    accepted_contract_total = serializers.DecimalField(max_digits=12, decimal_places=2)
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
    """Read-only per-project snapshot within a portfolio summary."""

    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    project_status = serializers.CharField()
    ar_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    ap_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    approved_change_orders_total = serializers.DecimalField(max_digits=12, decimal_places=2)


class PortfolioSnapshotSerializer(serializers.Serializer):
    """Read-only cross-project portfolio summary with aggregate AR/AP totals."""

    generated_at = serializers.DateTimeField()
    date_filter = serializers.JSONField()
    active_projects_count = serializers.IntegerField()
    ar_total_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    ap_total_outstanding = serializers.DecimalField(max_digits=12, decimal_places=2)
    overdue_invoice_count = serializers.IntegerField()
    overdue_vendor_bill_count = serializers.IntegerField()
    projects = PortfolioProjectSnapshotSerializer(many=True)


class ChangeImpactProjectSerializer(serializers.Serializer):
    """Read-only per-project change order impact breakdown."""

    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    approved_change_orders_count = serializers.IntegerField()
    approved_change_orders_total = serializers.DecimalField(max_digits=12, decimal_places=2)


class ChangeImpactSummarySerializer(serializers.Serializer):
    """Read-only cross-project change order impact summary."""

    generated_at = serializers.DateTimeField()
    date_filter = serializers.JSONField()
    approved_change_orders_count = serializers.IntegerField()
    approved_change_orders_total = serializers.DecimalField(max_digits=12, decimal_places=2)
    projects = ChangeImpactProjectSerializer(many=True)


class AttentionFeedItemSerializer(serializers.Serializer):
    """Read-only single attention feed item (overdue, upcoming, or action-needed)."""

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
    """Read-only attention feed with prioritized action items across projects."""

    generated_at = serializers.DateTimeField()
    due_soon_window_days = serializers.IntegerField()
    item_count = serializers.IntegerField()
    items = AttentionFeedItemSerializer(many=True)


class QuickJumpItemSerializer(serializers.Serializer):
    """Read-only single quick-jump search result entry."""

    kind = serializers.CharField()
    record_id = serializers.IntegerField()
    label = serializers.CharField()
    sub_label = serializers.CharField()
    project_id = serializers.IntegerField(allow_null=True)
    project_name = serializers.CharField(allow_blank=True)
    ui_href = serializers.CharField()
    detail_endpoint = serializers.CharField()


class QuickJumpSearchSerializer(serializers.Serializer):
    """Read-only quick-jump search response with matched items."""

    query = serializers.CharField()
    item_count = serializers.IntegerField()
    items = QuickJumpItemSerializer(many=True)


class ProjectTimelineItemSerializer(serializers.Serializer):
    """Read-only single project timeline event (financial or workflow)."""

    timeline_id = serializers.CharField()
    category = serializers.ChoiceField(choices=["financial", "workflow"])
    event_type = serializers.CharField()
    occurred_at = serializers.DateTimeField()
    label = serializers.CharField()
    detail = serializers.CharField(allow_blank=True)
    object_type = serializers.CharField()
    object_id = serializers.IntegerField()
    ui_route = serializers.CharField()


class ProjectTimelineSerializer(serializers.Serializer):
    """Read-only project timeline response with chronological event items."""

    project_id = serializers.IntegerField()
    project_name = serializers.CharField()
    category = serializers.ChoiceField(choices=["all", "financial", "workflow"])
    item_count = serializers.IntegerField()
    items = ProjectTimelineItemSerializer(many=True)
