from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.models import Organization, OrganizationMembership

User = get_user_model()


class OrganizationProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = [
            "id",
            "display_name",
            "slug",
            "logo_url",
            "invoice_sender_name",
            "invoice_sender_email",
            "invoice_sender_address",
            "invoice_default_due_days",
            "estimate_validation_delta_days",
            "invoice_default_terms",
            "estimate_default_terms",
            "change_order_default_reason",
            "invoice_default_footer",
            "invoice_default_notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class OrganizationMembershipSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_full_name = serializers.SerializerMethodField()
    is_current_user = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationMembership
        fields = [
            "id",
            "organization",
            "user",
            "user_email",
            "user_full_name",
            "role",
            "status",
            "role_template",
            "capability_flags_json",
            "created_at",
            "updated_at",
            "is_current_user",
        ]
        read_only_fields = [
            "id",
            "organization",
            "user",
            "user_email",
            "user_full_name",
            "role_template",
            "capability_flags_json",
            "created_at",
            "updated_at",
            "is_current_user",
        ]

    def get_user_full_name(self, obj: OrganizationMembership) -> str:
        full_name = obj.user.get_full_name().strip()
        if full_name:
            return full_name
        return obj.user.username or obj.user.email or f"user-{obj.user_id}"

    def get_is_current_user(self, obj: OrganizationMembership) -> bool:
        request = self.context.get("request")
        if not request or not request.user or not request.user.is_authenticated:
            return False
        return request.user.id == obj.user_id


class OrganizationProfileUpdateSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=255, required=False, allow_blank=False)
    slug = serializers.SlugField(max_length=80, required=False, allow_blank=True, allow_null=True)
    logo_url = serializers.URLField(required=False, allow_blank=True, default="")
    invoice_sender_name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    invoice_sender_email = serializers.EmailField(required=False, allow_blank=True, default="")
    invoice_sender_address = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    invoice_default_due_days = serializers.IntegerField(required=False, min_value=1, max_value=365)
    estimate_validation_delta_days = serializers.IntegerField(
        required=False, min_value=1, max_value=365
    )
    invoice_default_terms = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    estimate_default_terms = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    change_order_default_reason = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    invoice_default_footer = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    invoice_default_notes = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError(
                {"non_field_errors": ["Provide at least one field to update."]}
            )
        return attrs


class OrganizationMembershipUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=OrganizationMembership.Role.choices, required=False)
    status = serializers.ChoiceField(choices=OrganizationMembership.Status.choices, required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError(
                {"non_field_errors": ["Provide at least one field to update."]}
            )
        return attrs
