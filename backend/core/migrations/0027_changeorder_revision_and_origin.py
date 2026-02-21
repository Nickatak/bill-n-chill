from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0026_changeorderline"),
    ]

    operations = [
        migrations.AddField(
            model_name="changeorder",
            name="origin_estimate",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="originated_change_orders",
                to="core.estimate",
            ),
        ),
        migrations.AddField(
            model_name="changeorder",
            name="origin_estimate_version",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="changeorder",
            name="revision_number",
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name="changeorder",
            name="supersedes_change_order",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="revision_children",
                to="core.changeorder",
            ),
        ),
        migrations.AlterUniqueTogether(
            name="changeorder",
            unique_together={("project", "number", "revision_number")},
        ),
    ]
