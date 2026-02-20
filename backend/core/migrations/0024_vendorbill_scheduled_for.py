from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0023_vendorbill_status_planned"),
    ]

    operations = [
        migrations.AddField(
            model_name="vendorbill",
            name="scheduled_for",
            field=models.DateField(blank=True, null=True),
        ),
    ]
