"""Add phone_number, website_url, license_number, tax_id to Organization."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_organization_invite"),
    ]

    operations = [
        migrations.AddField(
            model_name="organization",
            name="phone_number",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
        migrations.AddField(
            model_name="organization",
            name="website_url",
            field=models.URLField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="organization",
            name="license_number",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="organization",
            name="tax_id",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
    ]
