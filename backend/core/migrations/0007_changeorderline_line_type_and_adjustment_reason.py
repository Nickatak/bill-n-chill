from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_invoiceline_budget_line"),
    ]

    operations = [
        migrations.AddField(
            model_name="changeorderline",
            name="line_type",
            field=models.CharField(
                choices=[("scope", "Scope"), ("adjustment", "Adjustment")],
                default="scope",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="changeorderline",
            name="adjustment_reason",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddConstraint(
            model_name="changeorderline",
            constraint=models.CheckConstraint(
                condition=Q(line_type="adjustment", adjustment_reason__gt="")
                | ~Q(line_type="adjustment"),
                name="co_line_adjustment_requires_reason",
            ),
        ),
    ]
