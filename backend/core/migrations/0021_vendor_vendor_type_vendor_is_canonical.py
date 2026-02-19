from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0020_estimate_public_token"),
    ]

    operations = [
        migrations.AddField(
            model_name="vendor",
            name="is_canonical",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="vendor",
            name="vendor_type",
            field=models.CharField(
                choices=[("trade", "Trade"), ("retail", "Retail")],
                default="trade",
                max_length=20,
            ),
        ),
    ]
