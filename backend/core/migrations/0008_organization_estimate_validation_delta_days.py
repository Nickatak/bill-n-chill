from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_changeorderline_line_type_and_adjustment_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="estimate_validation_delta_days",
            field=models.PositiveSmallIntegerField(default=30),
        ),
    ]
