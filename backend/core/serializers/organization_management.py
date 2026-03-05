"""Organization profile, membership, and invite serializers."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.models import Organization, OrganizationInvite, OrganizationMembership

User = get_user_model()


class OrganizationProfileSerializer(serializers.ModelSerializer):
    """Read-only organization profile with branding and document presets."""

    class Meta:
        model = Organization
        fields = [
            "id",
            "display_name",
            "logo_url",
            "help_email",
            "billing_address",
            "default_invoice_due_delta",
            "default_estimate_valid_delta",
            "invoice_terms_and_conditions",
            "estimate_terms_and_conditions",
            "change_order_terms_and_conditions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class OrganizationMembershipSerializer(serializers.ModelSerializer):
    """Read-only membership representation with computed user display fields."""

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
        """Return the member's full name, falling back to username or email."""
        full_name = obj.user.get_full_name().strip()
        if full_name:
            return full_name
        return obj.user.username or obj.user.email or f"user-{obj.user_id}"

    def get_is_current_user(self, obj: OrganizationMembership) -> bool:
        """Return whether this membership belongs to the requesting user."""
        request = self.context.get("request")
        if not request or not request.user or not request.user.is_authenticated:
            return False
        return request.user.id == obj.user_id


class OrganizationProfileUpdateSerializer(serializers.Serializer):
    """Write serializer for partial updates to organization profile fields."""

    display_name = serializers.CharField(max_length=255, required=False, allow_blank=False)
    logo_url = serializers.URLField(required=False, allow_blank=True, default="")
    help_email = serializers.EmailField(required=False, allow_blank=True, default="")
    billing_address = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    default_invoice_due_delta = serializers.IntegerField(required=False, min_value=1, max_value=365)
    default_estimate_valid_delta = serializers.IntegerField(required=False, min_value=1, max_value=365)
    invoice_terms_and_conditions = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    estimate_terms_and_conditions = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    change_order_terms_and_conditions = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError(
                {"non_field_errors": ["Provide at least one field to update."]}
            )
        return attrs


class OrganizationMembershipUpdateSerializer(serializers.Serializer):
    """Write serializer for updating a member's role or status."""

    role = serializers.ChoiceField(choices=OrganizationMembership.Role.choices, required=False)
    status = serializers.ChoiceField(choices=OrganizationMembership.Status.choices, required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError(
                {"non_field_errors": ["Provide at least one field to update."]}
            )
        return attrs


class OrganizationInviteSerializer(serializers.ModelSerializer):
    """Read serializer for listing pending invites."""

    invited_by_email = serializers.EmailField(source="invited_by.email", read_only=True)
    role_template_name = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationInvite
        fields = [
            "id",
            "email",
            "role",
            "role_template",
            "role_template_name",
            "invited_by_email",
            "token",
            "expires_at",
            "created_at",
        ]
        read_only_fields = fields

    def get_role_template_name(self, obj: OrganizationInvite) -> str:
        if obj.role_template_id and obj.role_template:
            return obj.role_template.name
        return ""


class OrganizationInviteCreateSerializer(serializers.Serializer):
    """Write serializer for creating an invite."""

    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=OrganizationMembership.Role.choices,
        default=OrganizationMembership.Role.VIEWER,
        required=False,
    )
    role_template_id = serializers.IntegerField(required=False, allow_null=True)
