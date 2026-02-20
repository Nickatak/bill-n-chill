from django.db import migrations, models


def _forwards_vendorbill_status_to_planned(apps, schema_editor):
    VendorBill = apps.get_model("core", "VendorBill")
    VendorBill.objects.filter(status="draft").update(status="planned")


def _backwards_vendorbill_status_to_draft(apps, schema_editor):
    VendorBill = apps.get_model("core", "VendorBill")
    VendorBill.objects.filter(status="planned").update(status="draft")


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0022_vendorbillallocation"),
    ]

    operations = [
        migrations.RunPython(
            _forwards_vendorbill_status_to_planned,
            _backwards_vendorbill_status_to_draft,
        ),
        migrations.AlterField(
            model_name="vendorbill",
            name="status",
            field=models.CharField(
                choices=[
                    ("planned", "Planned"),
                    ("received", "Received"),
                    ("approved", "Approved"),
                    ("scheduled", "Scheduled"),
                    ("paid", "Paid"),
                    ("void", "Void"),
                ],
                default="planned",
                max_length=32,
            ),
        ),
    ]
