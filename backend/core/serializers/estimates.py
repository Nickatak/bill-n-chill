from decimal import Decimal

from rest_framework import serializers

from core.models import Estimate, EstimateLineItem, EstimateStatusEvent


class EstimateLineItemSerializer(serializers.ModelSerializer):
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

    class Meta:
        model = Estimate
        fields = [
            "id",
            "project",
            "version",
            "status",
            "title",
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
    status = serializers.ChoiceField(choices=Estimate.Status.choices, required=False)
    status_note = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    tax_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    line_items = EstimateLineItemInputSerializer(many=True, required=False)

    def validate_title(self, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError("Title cannot be blank.")
        return trimmed

    def validate_status(self, value: str) -> str:
        allow_archived_status = bool(self.context.get("allow_archived_status", False))
        if value == Estimate.Status.ARCHIVED and not allow_archived_status:
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
