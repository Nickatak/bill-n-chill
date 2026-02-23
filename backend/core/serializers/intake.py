import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from rest_framework import serializers

from core.models import Customer, LeadContact, Project

PHONE_ALLOWED_RE = re.compile(r"^[0-9+\-().\s]+$")


def _is_valid_email(value: str) -> bool:
    try:
        validate_email(value)
    except DjangoValidationError:
        return False
    return True


def _is_valid_phone(value: str) -> bool:
    if not PHONE_ALLOWED_RE.fullmatch(value):
        return False
    digits = re.sub(r"\D", "", value)
    return 7 <= len(digits) <= 15


class LeadContactQuickAddSerializer(serializers.ModelSerializer):
    has_project = serializers.BooleanField(read_only=True)

    class Meta:
        model = LeadContact
        fields = [
            "id",
            "full_name",
            "phone",
            "project_address",
            "email",
            "initial_contract_value",
            "notes",
            "source",
            "is_archived",
            "has_project",
            "converted_customer",
            "converted_project",
            "converted_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "is_archived",
            "has_project",
            "converted_customer",
            "converted_project",
            "converted_at",
            "created_at",
        ]

    def create(self, validated_data):
        request = self.context["request"]
        return LeadContact.objects.create(created_by=request.user, **validated_data)

    def validate(self, attrs):
        phone = (attrs.get("phone") or "").strip()
        email = (attrs.get("email") or "").strip()

        # Intake allows one contact input that can be either phone or email.
        # If the value came through `phone` but is actually an email, remap it.
        if phone and not email and _is_valid_email(phone):
            email = phone.lower()
            phone = ""

        if phone and not _is_valid_phone(phone):
            raise serializers.ValidationError(
                {
                    "phone": [
                        "Contact method must be a valid phone number or email address.",
                    ]
                }
            )

        if email and not _is_valid_email(email):
            raise serializers.ValidationError(
                {"email": ["Enter a valid email address."]}
            )

        if not phone and not email:
            raise serializers.ValidationError(
                {
                    "phone": ["Provide a valid phone number or email address."],
                }
            )

        attrs["phone"] = phone
        attrs["email"] = email.lower() if email else ""
        return attrs


class LeadContactManageSerializer(serializers.ModelSerializer):
    has_project = serializers.BooleanField(read_only=True)

    class Meta:
        model = LeadContact
        fields = [
            "id",
            "full_name",
            "phone",
            "project_address",
            "email",
            "initial_contract_value",
            "notes",
            "source",
            "is_archived",
            "has_project",
            "converted_customer",
            "converted_project",
            "converted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "converted_customer",
            "converted_project",
            "converted_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        current_phone = ""
        current_email = ""
        if self.instance is not None:
            current_phone = self.instance.phone or ""
            current_email = self.instance.email or ""

        phone = (attrs.get("phone", current_phone) or "").strip()
        email = (attrs.get("email", current_email) or "").strip()

        if not phone and not email:
            raise serializers.ValidationError(
                {
                    "phone": ["Provide phone or email."],
                    "email": ["Provide phone or email."],
                }
            )
        return attrs


class LeadConvertSerializer(serializers.Serializer):
    project_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    project_status = serializers.ChoiceField(
        choices=Project.Status.choices,
        required=False,
        default=Project.Status.PROSPECT,
    )


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ["id", "display_name", "email", "phone", "billing_address", "created_at"]
