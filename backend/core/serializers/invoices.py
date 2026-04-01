"""Invoice serializers for read, write, and status-event representations."""

from rest_framework import serializers

from core.models import Invoice, InvoiceLine, InvoiceStatusEvent, Payment
from core.serializers.billing_periods import BillingPeriodSerializer
from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display


def _invoice_customer(obj):
    """Return the customer associated with the status event's invoice."""
    invoice = getattr(obj, "invoice", None)
    return getattr(invoice, "customer", None) or getattr(
        getattr(invoice, "project", None), "customer", None
    )


class InvoiceLineSerializer(serializers.ModelSerializer):
    """Read-only invoice line item with cost code details."""

    cost_code_code = serializers.CharField(source="cost_code.code", read_only=True)
    cost_code_name = serializers.CharField(source="cost_code.name", read_only=True)

    class Meta:
        model = InvoiceLine
        fields = [
            "id",
            "invoice",
            "cost_code",
            "cost_code_code",
            "cost_code_name",
            "description",
            "quantity",
            "unit",
            "unit_price",
            "line_total",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "invoice",
            "cost_code_code",
            "cost_code_name",
            "line_total",
            "created_at",
            "updated_at",
        ]


class InvoicePaymentSerializer(serializers.ModelSerializer):
    """Read-only payment summary for display on invoice detail."""

    applied_amount = serializers.DecimalField(source="amount", max_digits=12, decimal_places=2, read_only=True)
    payment_date = serializers.DateField(read_only=True)
    payment_method = serializers.CharField(source="method", read_only=True)
    payment_status = serializers.CharField(source="status", read_only=True)
    payment_reference = serializers.CharField(source="reference_number", read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "applied_amount",
            "payment_date",
            "payment_method",
            "payment_status",
            "payment_reference",
            "created_at",
        ]
        read_only_fields = fields


class InvoiceSerializer(serializers.ModelSerializer):
    """Read-only invoice with nested line items and customer display name."""

    customer_display_name = serializers.CharField(source="customer.display_name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    line_items = InvoiceLineSerializer(many=True, read_only=True)
    allocations = InvoicePaymentSerializer(
        source="target_payments", many=True, read_only=True,
    )
    public_ref = serializers.CharField(read_only=True)
    payment_schedule = serializers.SerializerMethodField()

    def get_payment_schedule(self, obj: Invoice) -> dict | None:
        """Return the linked quote's billing periods and total, if any."""
        quote = obj.related_quote
        if not quote:
            return None
        periods = quote.billing_periods.all().order_by("order")
        if not periods:
            return None
        return {
            "quote_total": str(quote.grand_total),
            "periods": BillingPeriodSerializer(periods, many=True).data,
        }

    class Meta:
        model = Invoice
        fields = [
            "id",
            "project",
            "project_name",
            "customer",
            "customer_display_name",
            "invoice_number",
            "public_ref",
            "status",
            "related_quote",
            "billing_period",
            "issue_date",
            "due_date",
            "sender_name",
            "sender_address",
            "sender_logo_url",
            "terms_text",
            "footer_text",
            "notes_text",
            "subtotal",
            "tax_percent",
            "tax_total",
            "total",
            "balance_due",
            "allocations",
            "payment_schedule",
            "line_items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "customer",
            "customer_display_name",
            "invoice_number",
            "related_quote",
            "billing_period",
            "subtotal",
            "tax_total",
            "total",
            "balance_due",
            "line_items",
            "created_at",
            "updated_at",
        ]


class InvoiceLineItemInputSerializer(serializers.Serializer):
    """Write serializer for a single invoice line item in a create/update payload."""

    cost_code = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(max_length=255)
    quantity = serializers.DecimalField(max_digits=12, decimal_places=2)
    unit = serializers.CharField(max_length=30, required=False, default="ea")
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)


class InvoiceWriteSerializer(serializers.Serializer):
    """Write serializer for creating or updating an invoice with line items."""

    ALLOWED_INITIAL_STATUSES = {"draft", "sent"}

    status = serializers.ChoiceField(choices=Invoice.Status.choices, required=False)
    status_note = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    related_quote = serializers.IntegerField(required=False, allow_null=True)
    billing_period = serializers.IntegerField(required=False, allow_null=True)
    initial_status = serializers.ChoiceField(
        choices=[("draft", "Draft"), ("sent", "Sent")],
        required=False,
    )
    issue_date = serializers.DateField(required=False)
    due_date = serializers.DateField(required=False)
    sender_name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    sender_address = serializers.CharField(max_length=5000, required=False, allow_blank=True, default="")
    sender_logo_url = serializers.URLField(required=False, allow_blank=True, default="")
    terms_text = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    footer_text = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    notes_text = serializers.CharField(max_length=10000, required=False, allow_blank=True, default="")
    tax_percent = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, default=0)
    line_items = InvoiceLineItemInputSerializer(many=True, required=False)


class InvoiceStatusEventSerializer(serializers.ModelSerializer):
    """Read-only invoice status event with computed action type and actor display."""

    changed_by_email = serializers.CharField(source="changed_by.email", read_only=True)
    changed_by_display = serializers.SerializerMethodField()
    changed_by_customer_id = serializers.SerializerMethodField()
    action_type = serializers.SerializerMethodField()

    def get_action_type(self, obj: InvoiceStatusEvent) -> str:
        """Classify the event as create, transition, resend, notate, or unchanged."""
        from_status = obj.from_status or ""
        to_status = obj.to_status or ""
        note = (obj.note or "").strip()
        if not from_status:
            return "create"
        if from_status != to_status:
            return "transition"
        if to_status == Invoice.Status.SENT and note.lower() in {"", "invoice re-sent."}:
            return "resend"
        if note:
            return "notate"
        return "unchanged"

    def get_changed_by_display(self, obj: InvoiceStatusEvent) -> str:
        """Return a human-readable display name for the actor who changed the status."""
        return resolve_public_actor_display(obj, actor_field="changed_by", customer_fn=_invoice_customer)

    def get_changed_by_customer_id(self, obj: InvoiceStatusEvent):
        """Return the customer ID if the actor acted via a public token."""
        return resolve_public_actor_customer_id(obj, customer_fn=_invoice_customer)

    class Meta:
        model = InvoiceStatusEvent
        fields = [
            "id",
            "invoice",
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
