from rest_framework import serializers

from core.models import ChangeOrder


class ChangeOrderSerializer(serializers.ModelSerializer):
    requested_by_email = serializers.EmailField(source="requested_by.email", read_only=True)
    approved_by_email = serializers.EmailField(source="approved_by.email", read_only=True)

    class Meta:
        model = ChangeOrder
        fields = [
            "id",
            "project",
            "number",
            "title",
            "status",
            "amount_delta",
            "days_delta",
            "reason",
            "requested_by",
            "requested_by_email",
            "approved_by",
            "approved_by_email",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "number",
            "requested_by",
            "requested_by_email",
            "approved_by",
            "approved_by_email",
            "approved_at",
            "created_at",
            "updated_at",
        ]


class ChangeOrderWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, allow_blank=False)
    status = serializers.ChoiceField(choices=ChangeOrder.Status.choices, required=False)
    amount_delta = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    days_delta = serializers.IntegerField(required=False)
    reason = serializers.CharField(max_length=5000, required=False, allow_blank=True)
