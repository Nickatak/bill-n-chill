from rest_framework import serializers

from core.models import FinancialAuditEvent


class FinancialAuditEventSerializer(serializers.ModelSerializer):
    created_by_email = serializers.EmailField(source="created_by.email", read_only=True)
    created_by_display = serializers.SerializerMethodField()
    created_by_customer_id = serializers.SerializerMethodField()

    @staticmethod
    def _is_public_decision_event(obj: FinancialAuditEvent) -> bool:
        metadata = obj.metadata_json or {}
        if isinstance(metadata, dict) and metadata.get("public_decision") is True:
            return True
        return "via public link" in (obj.note or "").lower()

    def get_created_by_display(self, obj: FinancialAuditEvent) -> str:
        if self._is_public_decision_event(obj):
            customer = getattr(getattr(obj, "project", None), "customer", None)
            if customer and (customer.display_name or "").strip():
                return customer.display_name.strip()
        actor_email = (getattr(getattr(obj, "created_by", None), "email", "") or "").strip()
        if actor_email:
            return actor_email
        if obj.created_by_id:
            return f"User #{obj.created_by_id}"
        return "Unknown user"

    def get_created_by_customer_id(self, obj: FinancialAuditEvent):
        if not self._is_public_decision_event(obj):
            return None
        customer = getattr(getattr(obj, "project", None), "customer", None)
        return customer.id if customer else None

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
            "created_by_display",
            "created_by_customer_id",
            "created_at",
        ]
        read_only_fields = fields
