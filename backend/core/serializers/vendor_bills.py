"""Vendor bill serializers for read, write, and line item representations."""

from django.db.models import Sum
from rest_framework import serializers

from core.models import VendorBill, VendorBillLine


class VendorBillLineSerializer(serializers.ModelSerializer):
    """Read-only vendor bill line item with cost code details."""

    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)

    class Meta:
        model = VendorBillLine
        fields = [
            "id",
            "vendor_bill",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "quantity",
            "unit_price",
            "amount",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class VendorBillSerializer(serializers.ModelSerializer):
    """Read-only vendor bill with nested line items, vendor/project names, and derived payment status."""

    project_name = serializers.CharField(source="project.name", read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    line_items = VendorBillLineSerializer(many=True, read_only=True)
    payment_status = serializers.SerializerMethodField()

    class Meta:
        model = VendorBill
        fields = [
            "id",
            "project",
            "project_name",
            "vendor",
            "vendor_name",
            "bill_number",
            "status",
            "payment_status",
            "received_date",
            "issue_date",
            "due_date",
            "subtotal",
            "tax_amount",
            "shipping_amount",
            "total",
            "balance_due",
            "line_items",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "project_name",
            "vendor_name",
            "balance_due",
            "payment_status",
            "created_at",
            "updated_at",
        ]

    def get_payment_status(self, obj) -> str:
        """Derive payment status from allocation coverage.

        Returns 'unpaid', 'partial', or 'paid'.
        """
        total = obj.total
        if total <= 0:
            return "paid"
        balance = obj.balance_due
        if balance <= 0:
            return "paid"
        if balance < total:
            return "partial"
        return "unpaid"


class VendorBillLineInputSerializer(serializers.Serializer):
    """Write serializer for a single vendor bill line item (description, quantity × unit_price)."""

    cost_code = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    quantity = serializers.DecimalField(max_digits=10, decimal_places=4, required=False, default=1)
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)


class VendorBillWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating a vendor bill with line items."""

    vendor = serializers.IntegerField(required=False, allow_null=True)
    bill_number = serializers.CharField(max_length=50, required=False, allow_blank=True)
    status = serializers.ChoiceField(
        choices=VendorBill.Status.choices,
        required=False,
    )
    received_date = serializers.DateField(required=False, allow_null=True)
    issue_date = serializers.DateField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    subtotal = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    tax_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    shipping_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    notes = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    line_items = VendorBillLineInputSerializer(many=True, required=False)
    duplicate_override = serializers.BooleanField(required=False, default=False)
