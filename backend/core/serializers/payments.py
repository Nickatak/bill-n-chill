from decimal import Decimal

from rest_framework import serializers

from core.models import Payment, PaymentAllocation


class PaymentAllocationSerializer(serializers.ModelSerializer):
    target_id = serializers.SerializerMethodField()

    class Meta:
        model = PaymentAllocation
        fields = [
            "id",
            "payment",
            "target_type",
            "target_id",
            "invoice",
            "vendor_bill",
            "applied_amount",
            "created_at",
        ]
        read_only_fields = fields

    def get_target_id(self, obj: PaymentAllocation):
        return obj.invoice_id if obj.target_type == PaymentAllocation.TargetType.INVOICE else obj.vendor_bill_id


class PaymentSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    allocations = PaymentAllocationSerializer(many=True, read_only=True)
    allocated_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    unapplied_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "project",
            "project_name",
            "direction",
            "method",
            "status",
            "amount",
            "payment_date",
            "reference_number",
            "notes",
            "allocated_total",
            "unapplied_amount",
            "allocations",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "project_name",
            "created_at",
            "updated_at",
            "allocated_total",
            "unapplied_amount",
            "allocations",
        ]


class PaymentWriteSerializer(serializers.Serializer):
    direction = serializers.ChoiceField(choices=Payment.Direction.choices, required=False)
    method = serializers.ChoiceField(choices=Payment.Method.choices, required=False)
    status = serializers.ChoiceField(choices=Payment.Status.choices, required=False)
    amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        min_value=Decimal("0.01"),
    )
    payment_date = serializers.DateField(required=False)
    reference_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    notes = serializers.CharField(max_length=5000, required=False, allow_blank=True)


class PaymentAllocationInputSerializer(serializers.Serializer):
    target_type = serializers.ChoiceField(choices=PaymentAllocation.TargetType.choices)
    target_id = serializers.IntegerField(min_value=1)
    applied_amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )


class PaymentAllocateSerializer(serializers.Serializer):
    allocations = PaymentAllocationInputSerializer(many=True, required=True)
