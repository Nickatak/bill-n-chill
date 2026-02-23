from rest_framework import serializers

from core.models import Invoice, InvoiceLine, InvoiceStatusEvent


class InvoiceLineSerializer(serializers.ModelSerializer):
    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)
    scope_item_name = serializers.CharField(source="scope_item.name", read_only=True)

    class Meta:
        model = InvoiceLine
        fields = [
            "id",
            "invoice",
            "line_type",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "scope_item",
            "scope_item_name",
            "adjustment_reason",
            "internal_note",
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
            "scope_item_name",
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
    line_type = serializers.ChoiceField(
        choices=InvoiceLine.LineType.choices,
        required=False,
        default=InvoiceLine.LineType.SCOPE,
    )
    cost_code = serializers.IntegerField(required=False, allow_null=True)
    scope_item = serializers.IntegerField(required=False, allow_null=True)
    adjustment_reason = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default="",
    )
    internal_note = serializers.CharField(
        max_length=5000,
        required=False,
        allow_blank=True,
        default="",
    )
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


class InvoiceStatusEventSerializer(serializers.ModelSerializer):
    changed_by_email = serializers.CharField(source="changed_by.email", read_only=True)

    class Meta:
        model = InvoiceStatusEvent
        fields = [
            "id",
            "invoice",
            "from_status",
            "to_status",
            "note",
            "changed_by",
            "changed_by_email",
            "changed_at",
        ]
        read_only_fields = fields
