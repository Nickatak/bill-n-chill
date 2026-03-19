"""Payment serializers for read and write flows."""

from decimal import Decimal

from rest_framework import serializers

from core.models import Payment


class PaymentSerializer(serializers.ModelSerializer):
    """Read-only payment with target document info."""

    customer_name = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    target_id = serializers.SerializerMethodField()

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
            "target_type",
            "target_id",
            "invoice",
            "vendor_bill",
            "receipt",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_customer_name(self, obj: Payment) -> str:
        """Return customer display name or empty string."""
        return obj.customer.display_name if obj.customer_id else ""

    def get_project_name(self, obj: Payment) -> str:
        """Return project name or empty string for unassigned payments."""
        return obj.project.name if obj.project_id else ""

    def get_target_id(self, obj: Payment) -> int | None:
        """Return the linked document ID."""
        return obj.invoice_id or obj.vendor_bill_id or obj.receipt_id


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
    target_type = serializers.ChoiceField(choices=Payment.TargetType.choices, required=False)
    target_id = serializers.IntegerField(min_value=1, required=False)
