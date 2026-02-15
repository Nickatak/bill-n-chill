from rest_framework import serializers

from core.models import Invoice, InvoiceLine


class InvoiceLineSerializer(serializers.ModelSerializer):
    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)

    class Meta:
        model = InvoiceLine
        fields = [
            "id",
            "invoice",
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
        read_only_fields = [
            "id",
            "invoice",
            "cost_code_code",
            "cost_code_name",
            "line_total",
            "created_at",
            "updated_at",
        ]


class InvoiceSerializer(serializers.ModelSerializer):
    customer_display_name = serializers.CharField(source="customer.display_name", read_only=True)
    line_items = InvoiceLineSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "project",
            "customer",
            "customer_display_name",
            "invoice_number",
            "status",
            "issue_date",
            "due_date",
            "subtotal",
            "tax_percent",
            "tax_total",
            "total",
            "balance_due",
            "line_items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "customer",
            "customer_display_name",
            "invoice_number",
            "subtotal",
            "tax_total",
            "total",
            "balance_due",
            "line_items",
            "created_at",
            "updated_at",
        ]


class InvoiceLineItemInputSerializer(serializers.Serializer):
    cost_code = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=2)
    unit = serializers.CharField(max_length=30, required=False, default="ea")
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)


class InvoiceWriteSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Invoice.Status.choices, required=False)
    issue_date = serializers.DateField(required=False)
    due_date = serializers.DateField(required=False)
    tax_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    line_items = InvoiceLineItemInputSerializer(many=True, required=False)
    scope_override = serializers.BooleanField(required=False, default=False)
    scope_override_note = serializers.CharField(
        max_length=5000,
        required=False,
        allow_blank=True,
        default="",
    )


class InvoiceScopeOverrideSerializer(serializers.Serializer):
    scope_override = serializers.BooleanField(required=False, default=False)
    scope_override_note = serializers.CharField(
        max_length=5000,
        required=False,
        allow_blank=True,
        default="",
    )
