"""Payment and payment allocation serializers for read, write, and allocation flows."""

from decimal import Decimal

from rest_framework import serializers

from core.models import Payment, PaymentAllocation


class PaymentAllocationSerializer(serializers.ModelSerializer):
    """Read-only payment allocation with polymorphic target ID resolution."""

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
        """Return the invoice or vendor bill ID based on target type."""
        return obj.invoice_id if obj.target_type == PaymentAllocation.TargetType.INVOICE else obj.vendor_bill_id


class PaymentSerializer(serializers.ModelSerializer):
    """Read-only payment with nested allocations and computed totals."""

    customer_name = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    allocations = PaymentAllocationSerializer(many=True, read_only=True)
    allocated_total = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    unapplied_amount = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "organization",
            "customer",
            "customer_name",
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
            "organization",
            "customer",
            "customer_name",
            "project",
            "project_name",
            "created_at",
            "updated_at",
            "allocated_total",
            "unapplied_amount",
            "allocations",
        ]

    def get_customer_name(self, obj: Payment) -> str:
        """Return customer display name or empty string."""
        return obj.customer.display_name if obj.customer_id else ""

    def get_project_name(self, obj: Payment) -> str:
        """Return project name or empty string for unassigned payments."""
        return obj.project.name if obj.project_id else ""


class PaymentWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating a payment."""

    customer = serializers.IntegerField(required=False, allow_null=True)
    project = serializers.IntegerField(required=False, allow_null=True)
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
    """Write serializer for a single allocation entry in an allocate payload."""

    target_type = serializers.ChoiceField(choices=PaymentAllocation.TargetType.choices)
    target_id = serializers.IntegerField(min_value=1)
    applied_amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )


class PaymentAllocateSerializer(serializers.Serializer):
    """Write serializer for batch-allocating a payment to invoices or vendor bills."""

    allocations = PaymentAllocationInputSerializer(many=True, required=True)
