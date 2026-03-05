"""Financial audit event serializers for immutable audit trail records."""

from rest_framework import serializers

from core.models import FinancialAuditEvent
from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display


def _audit_customer(obj):
    """Return the customer associated with the audit event's project."""
    return getattr(getattr(obj, "project", None), "customer", None)


class FinancialAuditEventSerializer(serializers.ModelSerializer):
    """Read-only financial audit event with resolved actor display fields."""

    created_by_email = serializers.EmailField(source="created_by.email", read_only=True)
    created_by_display = serializers.SerializerMethodField()
    created_by_customer_id = serializers.SerializerMethodField()

    def get_created_by_display(self, obj: FinancialAuditEvent) -> str:
        """Return a human-readable display name for the event creator."""
        return resolve_public_actor_display(obj, actor_field="created_by", customer_fn=_audit_customer)

    def get_created_by_customer_id(self, obj: FinancialAuditEvent):
        """Return the customer ID if the creator acted via a public token."""
        return resolve_public_actor_customer_id(obj, customer_fn=_audit_customer)

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
