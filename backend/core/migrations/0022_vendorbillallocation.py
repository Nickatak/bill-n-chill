from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0021_vendor_vendor_type_vendor_is_canonical"),
    ]

    operations = [
        migrations.CreateModel(
            name="VendorBillAllocation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("note", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "budget_line",
                    models.ForeignKey(
                        on_delete=models.PROTECT,
                        related_name="vendor_bill_allocations",
                        to="core.budgetline",
                    ),
                ),
                (
                    "vendor_bill",
                    models.ForeignKey(
                        on_delete=models.CASCADE,
                        related_name="allocations",
                        to="core.vendorbill",
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
    ]
