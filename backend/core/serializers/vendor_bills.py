from rest_framework import serializers

from core.models import VendorBill, VendorBillAllocation


class VendorBillAllocationSerializer(serializers.ModelSerializer):
    budget_line_cost_code = serializers.CharField(source="budget_line.cost_code.code", read_only=True)
    budget_line_description = serializers.CharField(source="budget_line.description", read_only=True)

    class Meta:
        model = VendorBillAllocation
        fields = [
            "id",
            "vendor_bill",
            "budget_line",
            "budget_line_cost_code",
            "budget_line_description",
            "amount",
            "note",
            "created_at",
        ]
        read_only_fields = fields


class VendorBillSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)
    allocations = VendorBillAllocationSerializer(many=True, read_only=True)

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
            "received_date",
            "issue_date",
            "due_date",
            "scheduled_for",
            "subtotal",
            "tax_amount",
            "shipping_amount",
            "total",
            "balance_due",
            "allocations",
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
            "created_at",
            "updated_at",
        ]


class VendorBillWriteSerializer(serializers.Serializer):
    vendor = serializers.IntegerField(required=False)
    bill_number = serializers.CharField(max_length=50, required=False, allow_blank=False)
    status = serializers.ChoiceField(
        choices=[*VendorBill.Status.choices, ("draft", "Draft (legacy)")],
        required=False,
    )
    received_date = serializers.DateField(required=False, allow_null=True)
    issue_date = serializers.DateField(required=False)
    due_date = serializers.DateField(required=False)
    scheduled_for = serializers.DateField(required=False, allow_null=True)
    subtotal = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    tax_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    shipping_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    notes = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    allocations = serializers.ListField(
        child=serializers.DictField(),
        required=False,
    )
    duplicate_override = serializers.BooleanField(required=False, default=False)

    def validate_status(self, value):
        # Backward-compatibility for in-flight clients during status rename rollout.
        if value == "draft":
            return VendorBill.Status.PLANNED
        return value

    def validate_allocations(self, value):
        normalized = []
        for item in value:
            budget_line = item.get("budget_line")
            amount = item.get("amount")
            note = item.get("note", "")
            if budget_line in (None, ""):
                raise serializers.ValidationError("Each allocation requires a budget_line.")
            if amount in (None, ""):
                raise serializers.ValidationError("Each allocation requires an amount.")
            try:
                amount_decimal = serializers.DecimalField(
                    max_digits=12,
                    decimal_places=2,
                ).to_internal_value(amount)
            except serializers.ValidationError as error:
                raise serializers.ValidationError(error.detail) from error
            if amount_decimal <= 0:
                raise serializers.ValidationError("Allocation amount must be greater than zero.")
            normalized.append(
                {
                    "budget_line": int(budget_line),
                    "amount": amount_decimal,
                    "note": str(note or "").strip(),
                }
            )
        return normalized
