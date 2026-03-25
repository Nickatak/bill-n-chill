"""Remove is_active from Vendor — vendors are either present or deleted."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_merge_store_into_vendor"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="vendor",
            name="is_active",
        ),
    ]
