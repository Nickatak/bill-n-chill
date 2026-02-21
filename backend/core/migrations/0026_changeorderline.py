from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0025_vendorbill_active_duplicate_guard"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChangeOrderLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("description", models.CharField(blank=True, max_length=255)),
                ("amount_delta", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("days_delta", models.IntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "budget_line",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="change_order_lines",
                        to="core.budgetline",
                    ),
                ),
                (
                    "change_order",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="line_items",
                        to="core.changeorder",
                    ),
                ),
            ],
            options={
                "ordering": ["id"],
            },
        ),
    ]
