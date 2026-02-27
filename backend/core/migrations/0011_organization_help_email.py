from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0010_changeorder_public_token"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="help_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
    ]
