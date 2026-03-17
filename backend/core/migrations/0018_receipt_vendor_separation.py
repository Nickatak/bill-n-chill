"""Receipt & Vendor model separation.

- Create standalone Receipt model (project-scoped expense record)
- Remove receipt-kind VendorBill rows and associated PaymentAllocations/Payments
- Remove kind, cost_code fields from VendorBill (if they exist)
- Make vendor non-nullable on VendorBill
- Remove vendor_type, is_canonical from Vendor
- Make organization non-nullable on Vendor
- Remove canonical vendor constraint

See docs/decisions/receipt-vendor-separation.md
"""

import django.db.models.deletion
from django.conf import settings
from django.db import connection, migrations, models


def _column_exists(table, column):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s",
            [table, column],
        )
        return cursor.fetchone()[0] > 0


def _constraint_exists(table, constraint):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND CONSTRAINT_NAME = %s",
            [table, constraint],
        )
        return cursor.fetchone()[0] > 0


def cleanup_vendor_bills_for_separation(apps, schema_editor):
    """Delete receipt-kind VendorBills and drop kind/cost_code columns."""
    with connection.cursor() as cursor:
        # Delete receipt rows via raw SQL to avoid ORM querying dropped columns
        if _column_exists("core_vendorbill", "kind"):
            # Get receipt bill IDs
            cursor.execute("SELECT id FROM core_vendorbill WHERE kind = 'receipt'")
            receipt_ids = [row[0] for row in cursor.fetchall()]

            if receipt_ids:
                ids_str = ",".join(str(i) for i in receipt_ids)
                # Get payment IDs from allocations to these receipts
                cursor.execute(
                    f"SELECT DISTINCT payment_id FROM core_paymentallocation "
                    f"WHERE vendor_bill_id IN ({ids_str})"
                )
                payment_ids = [row[0] for row in cursor.fetchall()]

                # Delete allocations
                cursor.execute(
                    f"DELETE FROM core_paymentallocation WHERE vendor_bill_id IN ({ids_str})"
                )

                # Delete orphaned payments
                for pid in payment_ids:
                    cursor.execute(
                        "SELECT COUNT(*) FROM core_paymentallocation WHERE payment_id = %s",
                        [pid],
                    )
                    if cursor.fetchone()[0] == 0:
                        cursor.execute("DELETE FROM core_payment WHERE id = %s", [pid])

                # Delete receipt vendor bills
                cursor.execute(f"DELETE FROM core_vendorbill WHERE id IN ({ids_str})")

        # Drop columns
        if _column_exists("core_vendorbill", "kind"):
            cursor.execute("ALTER TABLE `core_vendorbill` DROP COLUMN `kind`")
        if _column_exists("core_vendorbill", "cost_code_id"):
            # Drop FK constraint before dropping column
            cursor.execute(
                "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'core_vendorbill' "
                "AND COLUMN_NAME = 'cost_code_id' "
                "AND REFERENCED_TABLE_NAME IS NOT NULL"
            )
            for (fk_name,) in cursor.fetchall():
                cursor.execute(f"ALTER TABLE `core_vendorbill` DROP FOREIGN KEY `{fk_name}`")
            cursor.execute("ALTER TABLE `core_vendorbill` DROP COLUMN `cost_code_id`")


def cleanup_vendors_for_separation(apps, schema_editor):
    """Delete canonical vendors and drop canonical-related fields/constraints."""
    with connection.cursor() as cursor:
        # Delete canonical vendor rows (raw SQL to avoid ORM querying dropped columns)
        if _column_exists("core_vendor", "is_canonical"):
            cursor.execute("DELETE FROM `core_vendor` WHERE `is_canonical` = 1")

        # Drop constraint and columns
        if _constraint_exists("core_vendor", "vendor_org_required_unless_canonical"):
            cursor.execute(
                "ALTER TABLE `core_vendor` DROP CHECK `vendor_org_required_unless_canonical`"
            )
        if _column_exists("core_vendor", "vendor_type"):
            cursor.execute("ALTER TABLE `core_vendor` DROP COLUMN `vendor_type`")
        if _column_exists("core_vendor", "is_canonical"):
            cursor.execute("ALTER TABLE `core_vendor` DROP COLUMN `is_canonical`")


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0017_remove_recorded_status"),
    ]

    operations = [
        # 1. Create Store model
        migrations.CreateModel(
            name="Store",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="stores", to=settings.AUTH_USER_MODEL)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="stores", to="core.organization")),
            ],
            options={
                "ordering": ["name", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="store",
            constraint=models.UniqueConstraint(
                "organization",
                models.functions.Lower("name"),
                name="uniq_store_name_per_org_ci",
            ),
        ),
        # 2. Create Receipt model
        migrations.CreateModel(
            name="Receipt",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("receipt_date", models.DateField()),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="receipts", to=settings.AUTH_USER_MODEL)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="receipts", to="core.project")),
                ("store", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="receipts", to="core.store")),
            ],
            options={
                "ordering": ["-receipt_date", "-created_at"],
            },
        ),
        # 2. Clean up VendorBill: delete receipt rows, drop kind/cost_code columns
        #    SeparateDatabaseAndState so Django state tracks the field removals
        #    while RunPython handles the conditional SQL.
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(cleanup_vendor_bills_for_separation, migrations.RunPython.noop),
            ],
            state_operations=[
                migrations.RemoveField(model_name="vendorbill", name="kind"),
                migrations.RemoveField(model_name="vendorbill", name="cost_code"),
            ],
        ),
        # 3. Make vendor non-nullable on VendorBill
        migrations.AlterField(
            model_name="vendorbill",
            name="vendor",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="vendor_bills", to="core.vendor"),
        ),
        # 4. Clean up Vendor: delete canonical rows, drop constraint + fields
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(cleanup_vendors_for_separation, migrations.RunPython.noop),
            ],
            state_operations=[
                migrations.RemoveConstraint(
                    model_name="vendor",
                    name="vendor_org_required_unless_canonical",
                ),
                migrations.RemoveField(model_name="vendor", name="vendor_type"),
                migrations.RemoveField(model_name="vendor", name="is_canonical"),
            ],
        ),
        # 5. Make organization non-nullable on Vendor
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    "ALTER TABLE `core_vendor` MODIFY `organization_id` BIGINT NOT NULL",
                    migrations.RunSQL.noop,
                ),
            ],
            state_operations=[
                migrations.AlterField(
                    model_name="vendor",
                    name="organization",
                    field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="vendors", to="core.organization"),
                ),
            ],
        ),
    ]
