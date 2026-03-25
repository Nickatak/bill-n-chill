"""Replace invoice PARTIALLY_PAID/PAID statuses with OUTSTANDING/CLOSED.

- Migrate existing data: partially_paid → outstanding, paid → closed
- Remove the invoice_paid_requires_zero_balance_due constraint
- Update Invoice.status choices
- Update InvoiceStatusEvent choices
"""

from django.db import migrations, models


def migrate_invoice_statuses_forward(apps, schema_editor):
    """Convert partially_paid → outstanding, paid → closed."""
    Invoice = apps.get_model("core", "Invoice")
    Invoice.objects.filter(status="partially_paid").update(status="outstanding")
    Invoice.objects.filter(status="paid").update(status="closed")

    InvoiceStatusEvent = apps.get_model("core", "InvoiceStatusEvent")
    InvoiceStatusEvent.objects.filter(from_status="partially_paid").update(from_status="outstanding")
    InvoiceStatusEvent.objects.filter(to_status="partially_paid").update(to_status="outstanding")
    InvoiceStatusEvent.objects.filter(from_status="paid").update(from_status="closed")
    InvoiceStatusEvent.objects.filter(to_status="paid").update(to_status="closed")


def migrate_invoice_statuses_backward(apps, schema_editor):
    """Convert outstanding → partially_paid, closed → paid."""
    Invoice = apps.get_model("core", "Invoice")
    Invoice.objects.filter(status="outstanding").update(status="partially_paid")
    Invoice.objects.filter(status="closed").update(status="paid")

    InvoiceStatusEvent = apps.get_model("core", "InvoiceStatusEvent")
    InvoiceStatusEvent.objects.filter(from_status="outstanding").update(from_status="partially_paid")
    InvoiceStatusEvent.objects.filter(to_status="outstanding").update(to_status="partially_paid")
    InvoiceStatusEvent.objects.filter(from_status="closed").update(from_status="paid")
    InvoiceStatusEvent.objects.filter(to_status="closed").update(to_status="paid")


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0014_remove_vendor_is_active"),
    ]

    operations = [
        # 1. Remove the paid-requires-zero-balance constraint first
        migrations.RemoveConstraint(
            model_name="invoice",
            name="invoice_paid_requires_zero_balance_due",
        ),
        # 2. Migrate data before changing choices
        migrations.RunPython(
            migrate_invoice_statuses_forward,
            migrate_invoice_statuses_backward,
        ),
        # 3. Update Invoice.status field choices
        migrations.AlterField(
            model_name="invoice",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("sent", "Sent"),
                    ("outstanding", "Outstanding"),
                    ("closed", "Closed"),
                    ("void", "Void"),
                ],
                db_index=True,
                default="draft",
                max_length=32,
            ),
        ),
        # 4. Update InvoiceStatusEvent from_status/to_status choices
        migrations.AlterField(
            model_name="invoicestatusevent",
            name="from_status",
            field=models.CharField(
                blank=True,
                choices=[
                    ("draft", "Draft"),
                    ("sent", "Sent"),
                    ("outstanding", "Outstanding"),
                    ("closed", "Closed"),
                    ("void", "Void"),
                ],
                max_length=32,
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="invoicestatusevent",
            name="to_status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("sent", "Sent"),
                    ("outstanding", "Outstanding"),
                    ("closed", "Closed"),
                    ("void", "Void"),
                ],
                max_length=32,
            ),
        ),
    ]
