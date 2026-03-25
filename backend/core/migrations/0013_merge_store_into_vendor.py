"""Merge Store into Vendor — unified payee model.

1. Data migration: copy Store records into Vendor (deduplicating by name).
2. Update VendorBill rows: where store_id is set, point vendor_id at the
   migrated/matched vendor.
3. Remove the store FK from VendorBill.
4. Remove the Store model.
"""

from django.db import migrations


def merge_stores_into_vendors(apps, schema_editor):
    """Move Store records into Vendor, updating VendorBill FKs."""
    Store = apps.get_model("core", "Store")
    Vendor = apps.get_model("core", "Vendor")
    VendorBill = apps.get_model("core", "VendorBill")

    for store in Store.objects.all():
        # Check for an existing vendor with the same name (case-insensitive) in the same org.
        existing_vendor = Vendor.objects.filter(
            organization_id=store.organization_id,
            name__iexact=store.name,
        ).first()

        if existing_vendor:
            vendor_id = existing_vendor.id
        else:
            vendor = Vendor.objects.create(
                name=store.name,
                organization_id=store.organization_id,
                created_by_id=store.created_by_id,
            )
            vendor_id = vendor.id

        # Point any VendorBills that referenced this store at the vendor.
        VendorBill.objects.filter(store_id=store.id, vendor_id__isnull=True).update(
            vendor_id=vendor_id,
        )
        # If a bill already has a vendor AND a store, just clear the store reference
        # (vendor takes precedence). The FK removal below handles the rest.


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0012_unique_project_name_per_customer"),
    ]

    operations = [
        # Step 1: Data migration — move stores into vendors, update FKs.
        migrations.RunPython(merge_stores_into_vendors, migrations.RunPython.noop),
        # Step 2: Remove the store FK from VendorBill.
        migrations.RemoveField(
            model_name="vendorbill",
            name="store",
        ),
        # Step 3: Remove the Store model.
        migrations.DeleteModel(
            name="Store",
        ),
    ]
