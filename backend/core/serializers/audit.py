from rest_framework import serializers

from core.models import FinancialAuditEvent


class FinancialAuditEventSerializer(serializers.ModelSerializer):
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
            "created_at",
        ]
        read_only_fields = fields
