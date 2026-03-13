"""Add customer FK to Payment and backfill from project.customer for inbound payments."""

import django.db.models.deletion
from django.db import migrations, models


def backfill_customer_from_project(apps, schema_editor):
    """For inbound payments that have a project, copy project.customer to payment.customer."""
    Payment = apps.get_model("core", "Payment")
    for payment in Payment.objects.filter(direction="inbound", project__isnull=False, customer__isnull=True).select_related("project"):
        payment.customer_id = payment.project.customer_id
        payment.save(update_fields=["customer_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_payment_org_scoping"),
    ]

    operations = [
        # Step 1: Add nullable customer FK
        migrations.AddField(
            model_name="payment",
            name="customer",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="payments",
                to="core.customer",
            ),
        ),
        # Step 2: Backfill from project.customer for inbound payments
        migrations.RunPython(backfill_customer_from_project, migrations.RunPython.noop),
    ]
