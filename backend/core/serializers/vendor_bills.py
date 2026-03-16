"""Vendor bill serializers for read, write, and line item representations."""

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
            "unit",
            "unit_price",
            "line_total",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class VendorBillSerializer(serializers.ModelSerializer):
    """Read-only vendor bill with nested line items and vendor/project names."""

    project_name = serializers.CharField(source="project.name", read_only=True)
    vendor_name = serializers.SerializerMethodField()
    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True, default=None)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True, default=None)
    line_items = VendorBillLineSerializer(many=True, read_only=True)

    class Meta:
        model = VendorBill
        fields = [
            "id",
            "kind",
            "project",
            "project_name",
            "vendor",
            "vendor_name",
            "bill_number",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "status",
            "received_date",
            "issue_date",
            "due_date",
            "scheduled_for",
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
            "kind",
            "project",
            "project_name",
            "vendor_name",
            "cost_code_code",
            "cost_code_name",
            "balance_due",
            "created_at",
            "updated_at",
        ]

    def get_vendor_name(self, obj) -> str:
        """Return vendor name or empty string if no vendor (receipts)."""
        return obj.vendor.name if obj.vendor_id else ""


class VendorBillLineInputSerializer(serializers.Serializer):
    """Write serializer for a single vendor bill line item."""

    cost_code = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    quantity = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, default=1)
    unit = serializers.CharField(max_length=30, required=False, default="ea")
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)


class VendorBillWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating a vendor bill with line items."""

    kind = serializers.ChoiceField(choices=VendorBill.Kind.choices, required=False)
    vendor = serializers.IntegerField(required=False, allow_null=True)
    bill_number = serializers.CharField(max_length=50, required=False, allow_blank=True)
    cost_code = serializers.IntegerField(required=False, allow_null=True)
    status = serializers.ChoiceField(
        choices=VendorBill.Status.choices,
        required=False,
    )
    received_date = serializers.DateField(required=False, allow_null=True)
    issue_date = serializers.DateField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    scheduled_for = serializers.DateField(required=False, allow_null=True)
    subtotal = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    tax_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    shipping_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    notes = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    line_items = VendorBillLineInputSerializer(many=True, required=False)
    duplicate_override = serializers.BooleanField(required=False, default=False)
