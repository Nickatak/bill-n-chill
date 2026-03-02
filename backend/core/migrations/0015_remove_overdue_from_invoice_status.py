"""Remove 'overdue' from Invoice status enum and convert existing rows.

Overdue is now a computed condition (due_date < today) rather than a stored status.
Any invoices currently in 'overdue' status are migrated back to 'sent'.
"""

from django.db import migrations, models


def migrate_overdue_to_sent(apps, schema_editor):
    Invoice = apps.get_model("core", "Invoice")
    Invoice.objects.filter(status="overdue").update(status="sent")


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0014_add_received_date_subtotal_tax_shipping_to_vendor_bill"),
    ]

    operations = [
        migrations.RunPython(migrate_overdue_to_sent, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="invoice",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("sent", "Sent"),
                    ("partially_paid", "Partially Paid"),
                    ("paid", "Paid"),
                    ("void", "Void"),
                ],
                default="draft",
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="invoicestatusevent",
            name="from_status",
            field=models.CharField(
                blank=True,
                choices=[
                    ("draft", "Draft"),
                    ("sent", "Sent"),
                    ("partially_paid", "Partially Paid"),
                    ("paid", "Paid"),
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
                    ("partially_paid", "Partially Paid"),
                    ("paid", "Paid"),
                    ("void", "Void"),
                ],
                max_length=32,
            ),
        ),
    ]
