from rest_framework import serializers

from core.models import Customer, LeadContact, Project


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
