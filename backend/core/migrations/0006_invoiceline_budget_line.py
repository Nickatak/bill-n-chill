from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_organization_change_order_default_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoiceline",
            name="budget_line",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="invoice_lines",
                to="core.budgetline",
            ),
        ),
    ]
