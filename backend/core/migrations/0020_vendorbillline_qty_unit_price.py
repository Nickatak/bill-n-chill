"""Add quantity and unit_price to VendorBillLine.

Data migration: set unit_price = amount for existing rows so that
quantity (1) × unit_price = amount, preserving stored totals.
"""

from django.db import migrations, models


def set_unit_price_from_amount(apps, schema_editor):
    VendorBillLine = apps.get_model("core", "VendorBillLine")
    lines = list(VendorBillLine.objects.all())
    for line in lines:
        line.unit_price = line.amount
    VendorBillLine.objects.bulk_update(lines, ["unit_price"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0019_receipt_allocation_target"),
    ]

    operations = [
        migrations.AddField(
            model_name="vendorbillline",
            name="quantity",
            field=models.DecimalField(decimal_places=4, default=1, max_digits=10),
        ),
        migrations.AddField(
            model_name="vendorbillline",
            name="unit_price",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.RunPython(set_unit_price_from_amount, migrations.RunPython.noop),
    ]
