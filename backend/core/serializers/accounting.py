from rest_framework import serializers

from core.models import AccountingSyncEvent


class AccountingSyncEventSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = AccountingSyncEvent
        fields = [
            "id",
            "project",
            "project_name",
            "provider",
            "object_type",
            "object_id",
            "direction",
            "status",
            "external_id",
            "error_message",
            "retry_count",
            "last_attempt_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "project_name",
            "retry_count",
            "last_attempt_at",
            "created_at",
            "updated_at",
        ]


class AccountingSyncEventWriteSerializer(serializers.Serializer):
    provider = serializers.ChoiceField(choices=AccountingSyncEvent.Provider.choices, required=False)
    object_type = serializers.CharField(max_length=50, required=False, allow_blank=False)
    object_id = serializers.IntegerField(required=False, min_value=1, allow_null=True)
    direction = serializers.ChoiceField(choices=AccountingSyncEvent.Direction.choices, required=False)
    status = serializers.ChoiceField(choices=AccountingSyncEvent.Status.choices, required=False)
    external_id = serializers.CharField(max_length=100, required=False, allow_blank=True)
    error_message = serializers.CharField(max_length=5000, required=False, allow_blank=True)
