"""Quote serializers for read, write, duplication, and status-event representations."""

from decimal import Decimal

from rest_framework import serializers

from core.models import Quote, QuoteLineItem, QuoteSection, QuoteStatusEvent
from core.serializers.billing_periods import BillingPeriodInputSerializer, BillingPeriodSerializer
from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display


def _quote_customer(obj):
    """Return the customer associated with the status event's quote project."""
    return getattr(getattr(getattr(obj, "quote", None), "project", None), "customer", None)


class QuoteLineItemSerializer(serializers.ModelSerializer):
    """Read-only quote line item with cost code details."""

    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)
    cost_code_taxable = serializers.BooleanField(source="cost_code.taxable", read_only=True)

    class Meta:
        model = QuoteLineItem
        fields = [
            "id",
            "quote",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "cost_code_taxable",
            "description",
            "quantity",
            "unit",
            "unit_price",
            "markup_percent",
            "line_total",
            "order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "line_total", "created_at", "updated_at"]


class QuoteSectionSerializer(serializers.ModelSerializer):
    """Read-only quote section with stored subtotal."""

    class Meta:
        model = QuoteSection
        fields = [
            "id",
            "name",
            "order",
            "subtotal",
        ]
        read_only_fields = fields


class QuoteSerializer(serializers.ModelSerializer):
    """Read-only quote with nested line items and sections."""

    line_items = QuoteLineItemSerializer(many=True, read_only=True)
    sections = QuoteSectionSerializer(many=True, read_only=True)
    billing_periods = BillingPeriodSerializer(many=True, read_only=True)
    public_ref = serializers.CharField(read_only=True)
    contract_pdf_url = serializers.SerializerMethodField()

    def get_contract_pdf_url(self, obj: Quote) -> str:
        """Return the absolute URL for the uploaded contract PDF, or empty string."""
        if not obj.contract_pdf:
            return ""
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.contract_pdf.url)
        return ""

    class Meta:
        model = Quote
        fields = [
            "id",
            "project",
            "version",
            "status",
            "title",
            "valid_through",
            "terms_text",
            "notes_text",
            "sender_name",
            "sender_address",
            "sender_logo_url",
            "contract_pdf_url",
            "subtotal",
            "markup_total",
            "contingency_percent",
            "contingency_total",
            "overhead_profit_percent",
            "overhead_profit_total",
            "insurance_percent",
            "insurance_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "public_ref",
            "line_items",
            "sections",
            "billing_periods",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "version",
            "sender_name",
            "sender_address",
            "sender_logo_url",
            "subtotal",
            "markup_total",
            "contingency_total",
            "overhead_profit_total",
            "insurance_total",
            "tax_total",
            "grand_total",
            "line_items",
            "sections",
            "billing_periods",
            "created_at",
            "updated_at",
        ]


class QuoteStatusEventSerializer(serializers.ModelSerializer):
    """Read-only quote status event with computed action type and actor display."""

    changed_by_email = serializers.CharField(source="changed_by.email", read_only=True)
    changed_by_display = serializers.SerializerMethodField()
    changed_by_customer_id = serializers.SerializerMethodField()
    action_type = serializers.SerializerMethodField()

    def get_action_type(self, obj: QuoteStatusEvent) -> str:
        """Classify the event as create, transition, resend, notate, or unchanged."""
        from_status = obj.from_status or ""
        to_status = obj.to_status or ""
        note = (obj.note or "").strip()
        if not from_status:
            return "create"
        if from_status != to_status:
            return "transition"
        if to_status == Quote.Status.SENT and note.lower() in {"", "quote re-sent."}:
            return "resend"
        if note:
            return "notate"
        return "unchanged"

    def get_changed_by_display(self, obj: QuoteStatusEvent) -> str:
        """Return a human-readable display name for the actor who changed the status."""
        return resolve_public_actor_display(obj, actor_field="changed_by", customer_fn=_quote_customer)

    def get_changed_by_customer_id(self, obj: QuoteStatusEvent):
        """Return the customer ID if the actor acted via a public token."""
        return resolve_public_actor_customer_id(obj, customer_fn=_quote_customer)

    class Meta:
        model = QuoteStatusEvent
        fields = [
            "id",
            "quote",
            "from_status",
            "to_status",
            "note",
            "changed_by",
            "changed_by_email",
            "changed_by_display",
            "changed_by_customer_id",
            "changed_at",
            "action_type",
        ]
        read_only_fields = fields


class QuoteLineItemInputSerializer(serializers.Serializer):
    """Write serializer for a single quote line item in a create/update payload."""

    cost_code = serializers.IntegerField()
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=2)
    unit = serializers.CharField(max_length=30, required=False, default="ea")
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    markup_percent = serializers.DecimalField(
        max_digits=6, decimal_places=2, required=False, default=Decimal("0")
    )
    order = serializers.IntegerField(required=False, default=0)


class QuoteSectionInputSerializer(serializers.Serializer):
    """Write serializer for a single quote section in a create/update payload."""

    name = serializers.CharField(max_length=200)
    order = serializers.IntegerField()


class QuoteWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating an quote with line items."""

    title = serializers.CharField(max_length=255, required=True, allow_blank=False)
    allow_existing_title_family = serializers.BooleanField(required=False, default=False)
    status = serializers.ChoiceField(choices=Quote.Status.choices, required=False)
    status_note = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    notify_customer = serializers.BooleanField(required=False, default=True)
    valid_through = serializers.DateField(required=False, allow_null=True)
    terms_text = serializers.CharField(max_length=10000, required=False, allow_blank=True)
    notes_text = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    tax_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    contingency_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    overhead_profit_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    insurance_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    line_items = QuoteLineItemInputSerializer(many=True, required=False)
    sections = QuoteSectionInputSerializer(many=True, required=False, default=[])
    billing_periods = BillingPeriodInputSerializer(many=True, required=False, default=[])

    def validate_billing_periods(self, periods: list[dict]) -> list[dict]:
        """Validate billing period descriptions and percentage total when provided."""
        if not periods:
            return periods
        blank_descriptions = [
            i + 1 for i, p in enumerate(periods) if not (p.get("description") or "").strip()
        ]
        if blank_descriptions:
            positions = ", ".join(str(n) for n in blank_descriptions)
            raise serializers.ValidationError(
                f"Every billing period needs a description (missing on period {positions})."
            )
        total = sum(Decimal(str(p["percent"])) for p in periods)
        if total != Decimal("100.00"):
            raise serializers.ValidationError(
                f"Billing period percentages must sum to 100% (currently {total}%)."
            )
        return periods

    def validate_title(self, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError("Title cannot be blank.")
        return trimmed

    def validate_status(self, value: str) -> str:
        if value == Quote.Status.ARCHIVED:
            raise serializers.ValidationError(
                "Archived status is system-controlled and cannot be set directly."
            )
        return value
