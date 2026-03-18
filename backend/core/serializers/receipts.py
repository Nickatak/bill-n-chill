"""Receipt serializers for read and write representations."""

from rest_framework import serializers

from core.models.accounts_payable.receipt import Receipt
from core.models.cash_management.payment import PaymentAllocation


class ReceiptAllocationSerializer(serializers.ModelSerializer):
    """Read-only allocation summary surfacing parent payment details."""

    payment_date = serializers.DateField(source="payment.payment_date", read_only=True)
    payment_method = serializers.CharField(source="payment.method", read_only=True)
    payment_status = serializers.CharField(source="payment.status", read_only=True)
    payment_reference = serializers.CharField(source="payment.reference_number", read_only=True)

    class Meta:
        model = PaymentAllocation
        fields = [
            "id",
            "payment",
            "applied_amount",
            "payment_date",
            "payment_method",
            "payment_status",
            "payment_reference",
            "created_at",
        ]
        read_only_fields = fields


class ReceiptSerializer(serializers.ModelSerializer):
    """Read-only receipt representation."""

    project_name = serializers.CharField(source="project.name", read_only=True)
    store_name = serializers.SerializerMethodField()
    allocations = ReceiptAllocationSerializer(
        source="payment_allocations", many=True, read_only=True,
    )

    class Meta:
        model = Receipt
        fields = [
            "id",
            "project",
            "project_name",
            "store",
            "store_name",
            "amount",
            "balance_due",
            "allocations",
            "receipt_date",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_store_name(self, obj) -> str:
        """Return store name or empty string if no store."""
        return obj.store.name if obj.store_id else ""


class ReceiptWriteSerializer(serializers.Serializer):
    """Write serializer for creating a receipt."""

    store_name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    receipt_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
