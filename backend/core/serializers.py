from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.models import (
    CostCode,
    Customer,
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    LeadContact,
    Project,
)

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, attrs):
        email = attrs["email"].strip().lower()
        password = attrs["password"]

        users = User.objects.filter(email__iexact=email, is_active=True)
        if users.count() != 1:
            raise serializers.ValidationError("Invalid email or password.")

        user = users.first()
        if not user.check_password(password):
            raise serializers.ValidationError("Invalid email or password.")

        attrs["user"] = user
        return attrs


class LeadContactQuickAddSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeadContact
        fields = [
            "id",
            "full_name",
            "phone",
            "project_address",
            "email",
            "notes",
            "status",
            "source",
            "converted_customer",
            "converted_project",
            "converted_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "converted_customer",
            "converted_project",
            "converted_at",
            "created_at",
        ]

    def create(self, validated_data):
        request = self.context["request"]
        return LeadContact.objects.create(created_by=request.user, **validated_data)


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


class ProjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = [
            "id",
            "customer",
            "name",
            "status",
            "contract_value_original",
            "contract_value_current",
            "start_date_planned",
            "end_date_planned",
            "created_at",
        ]


class ProjectProfileSerializer(serializers.ModelSerializer):
    customer_display_name = serializers.CharField(source="customer.display_name", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "customer",
            "customer_display_name",
            "name",
            "status",
            "contract_value_original",
            "contract_value_current",
            "start_date_planned",
            "end_date_planned",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "customer", "customer_display_name", "created_at", "updated_at"]


class CostCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostCode
        fields = ["id", "code", "name", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class EstimateLineItemSerializer(serializers.ModelSerializer):
    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)

    class Meta:
        model = EstimateLineItem
        fields = [
            "id",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "quantity",
            "unit",
            "unit_cost",
            "markup_percent",
            "line_total",
        ]
        read_only_fields = ["id", "cost_code_code", "cost_code_name", "line_total"]


class EstimateSerializer(serializers.ModelSerializer):
    line_items = EstimateLineItemSerializer(many=True, read_only=True)

    class Meta:
        model = Estimate
        fields = [
            "id",
            "project",
            "version",
            "status",
            "title",
            "subtotal",
            "markup_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "line_items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "version",
            "subtotal",
            "markup_total",
            "tax_total",
            "grand_total",
            "line_items",
            "created_at",
            "updated_at",
        ]


class EstimateStatusEventSerializer(serializers.ModelSerializer):
    changed_by_email = serializers.EmailField(source="changed_by.email", read_only=True)

    class Meta:
        model = EstimateStatusEvent
        fields = [
            "id",
            "estimate",
            "from_status",
            "to_status",
            "note",
            "changed_by",
            "changed_by_email",
            "changed_at",
        ]
        read_only_fields = fields


class EstimateLineItemInputSerializer(serializers.Serializer):
    cost_code = serializers.IntegerField()
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=2)
    unit = serializers.CharField(max_length=30, required=False, default="ea")
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    markup_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)


class EstimateWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=Estimate.Status.choices, required=False)
    status_note = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    tax_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    line_items = EstimateLineItemInputSerializer(many=True, required=False)
