# Manual migration to drop stale payment_id column from Receipt table.
# This column was part of an old 1:1 Receipt-Payment design that was removed
# from the model but the column was never dropped from the DB.
#
# Uses RunPython instead of RunSQL so the drop is idempotent — on fresh
# databases (created after the 0001 recompaction) the column never existed.

from django.db import migrations


def drop_receipt_payment_fk(apps, schema_editor):
    """Drop payment_id FK and column from core_receipt if they exist."""
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_receipt' "
            "AND COLUMN_NAME = 'payment_id'"
        )
        if cursor.fetchone()[0] == 0:
            return

        cursor.execute(
            "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'core_receipt' "
            "AND CONSTRAINT_NAME = 'core_receipt_payment_id_e901c545_fk_core_payment_id'"
        )
        if cursor.fetchone()[0] > 0:
            cursor.execute(
                "ALTER TABLE core_receipt DROP FOREIGN KEY "
                "core_receipt_payment_id_e901c545_fk_core_payment_id"
            )

        cursor.execute("ALTER TABLE core_receipt DROP COLUMN payment_id")


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0022_payment_direct_target'),
    ]

    operations = [
        migrations.RunPython(drop_receipt_payment_fk, migrations.RunPython.noop),
    ]
