from rest_framework import serializers

from core.models import FinancialAuditEvent


class FinancialAuditEventSerializer(serializers.ModelSerializer):
    created_by_email = serializers.EmailField(source="created_by.email", read_only=True)

    class Meta:
        model = FinancialAuditEvent
        fields = [
            "id",
            "project",
            "event_type",
            "object_type",
            "object_id",
            "from_status",
            "to_status",
            "amount",
            "note",
            "metadata_json",
            "created_by",
            "created_by_email",
            "created_at",
        ]
        read_only_fields = fields
