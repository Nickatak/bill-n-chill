"""Vendor serializers for read and write representations."""

from rest_framework import serializers

from core.models import Vendor


class VendorSerializer(serializers.ModelSerializer):
    """Read-only vendor representation."""

    class Meta:
        model = Vendor
        fields = [
            "id",
            "name",
            "email",
            "phone",
            "tax_id_last4",
            "notes",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class VendorWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating a vendor."""

    name = serializers.CharField(max_length=255, required=False, allow_blank=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=50, required=False, allow_blank=True)
    tax_id_last4 = serializers.CharField(max_length=4, required=False, allow_blank=True)
    notes = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)
    duplicate_override = serializers.BooleanField(required=False, default=False)

    def validate_tax_id_last4(self, value):
        if value and not value.isdigit():
            raise serializers.ValidationError("tax_id_last4 must contain digits only.")
        return value
