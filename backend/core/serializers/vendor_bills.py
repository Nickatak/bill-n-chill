from rest_framework import serializers

from core.models import VendorBill


class VendorBillSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    vendor_name = serializers.CharField(source="vendor.name", read_only=True)

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
            "issue_date",
            "due_date",
            "total",
            "balance_due",
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
    status = serializers.ChoiceField(choices=VendorBill.Status.choices, required=False)
    issue_date = serializers.DateField(required=False)
    due_date = serializers.DateField(required=False)
    total = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    notes = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    duplicate_override = serializers.BooleanField(required=False, default=False)
