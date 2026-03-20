# Manual migration to drop stale payment_id column from Receipt table.
# This column was part of an old 1:1 Receipt-Payment design that was removed
# from the model but the column was never dropped from the DB.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0022_payment_direct_target'),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE core_receipt DROP FOREIGN KEY core_receipt_payment_id_e901c545_fk_core_payment_id;",
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.RunSQL(
            sql="ALTER TABLE core_receipt DROP COLUMN payment_id;",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
