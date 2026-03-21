"""Fix prod column name left behind by migration squash.

The squash (c49ff5d) consolidated the unit_cost → unit_price rename into
0001_initial, but prod already had 0001_initial marked as applied with
the old column name.  This migration renames the column if it still
exists, and is a no-op on fresh databases that already have unit_price.
"""

from django.db import migrations


def rename_if_needed(apps, schema_editor):
    connection = schema_editor.connection
    cursor = connection.cursor()
    cursor.execute("DESCRIBE core_estimatelineitem")
    columns = {row[0] for row in cursor.fetchall()}
    if "unit_cost" in columns and "unit_price" not in columns:
        cursor.execute(
            "ALTER TABLE core_estimatelineitem "
            "CHANGE COLUMN unit_cost unit_price decimal(12,2) NOT NULL"
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(rename_if_needed, migrations.RunPython.noop),
    ]
