"""Billing period serializers for read and embedded-write representations."""

from rest_framework import serializers

from core.models import BillingPeriod


class BillingPeriodSerializer(serializers.ModelSerializer):
    """Read-only billing period."""

    class Meta:
        model = BillingPeriod
        fields = [
            "id",
            "estimate",
            "description",
            "percent",
            "due_date",
            "order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class BillingPeriodInputSerializer(serializers.Serializer):
    """Write serializer for a single billing period embedded in an estimate payload."""

    description = serializers.CharField(max_length=255, allow_blank=True)
    percent = serializers.DecimalField(max_digits=6, decimal_places=2)
    due_date = serializers.DateField(required=False, allow_null=True)
    order = serializers.IntegerField()
