"""Replace Organization.billing_address (text) with structured address fields."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_add_onboarding_completed"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="organization",
            name="billing_address",
        ),
        migrations.AddField(
            model_name="organization",
            name="billing_street_1",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="organization",
            name="billing_street_2",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="organization",
            name="billing_city",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="organization",
            name="billing_state",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
        migrations.AddField(
            model_name="organization",
            name="billing_zip",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
    ]
