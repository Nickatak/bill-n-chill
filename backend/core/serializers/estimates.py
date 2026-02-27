from decimal import Decimal

from rest_framework import serializers

from core.models import Estimate, EstimateLineItem, EstimateStatusEvent


class EstimateLineItemSerializer(serializers.ModelSerializer):
    scope_item = serializers.IntegerField(source="scope_item_id", read_only=True)
    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)

    class Meta:
        model = EstimateLineItem
        fields = [
            "id",
            "estimate",
            "scope_item",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "quantity",
            "unit",
            "unit_cost",
            "markup_percent",
            "line_total",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "line_total", "created_at", "updated_at"]


class EstimateSerializer(serializers.ModelSerializer):
    line_items = EstimateLineItemSerializer(many=True, read_only=True)
    public_ref = serializers.CharField(read_only=True)
    financial_baseline_status = serializers.SerializerMethodField()
    is_active_financial_baseline = serializers.SerializerMethodField()

    def get_financial_baseline_status(self, obj: Estimate) -> str:
        status_by_estimate_id = self.context.get("financial_baseline_status_by_estimate_id", {})
        return status_by_estimate_id.get(obj.id, "none")

    def get_is_active_financial_baseline(self, obj: Estimate) -> bool:
        return self.get_financial_baseline_status(obj) == "active"

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
            "subtotal",
            "markup_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "public_ref",
            "financial_baseline_status",
            "is_active_financial_baseline",
            "line_items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "version",
            "subtotal",
            "markup_total",
            "tax_total",
            "grand_total",
            "line_items",
            "created_at",
            "updated_at",
        ]


class EstimateStatusEventSerializer(serializers.ModelSerializer):
    changed_by_email = serializers.CharField(source="changed_by.email", read_only=True)
    action_type = serializers.SerializerMethodField()

    def get_action_type(self, obj: EstimateStatusEvent) -> str:
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
            "changed_at",
            "action_type",
        ]
        read_only_fields = fields


class EstimateLineItemInputSerializer(serializers.Serializer):
    cost_code = serializers.IntegerField()
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=2)
    unit = serializers.CharField(max_length=30, required=False, default="ea")
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    markup_percent = serializers.DecimalField(
        max_digits=6, decimal_places=2, required=False, default=Decimal("0")
    )


class EstimateWriteSerializer(serializers.Serializer):
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
    project_id = serializers.IntegerField(required=False)
    title = serializers.CharField(max_length=255, required=True, allow_blank=False)

    def validate_title(self, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError("Title cannot be blank.")
        return trimmed
