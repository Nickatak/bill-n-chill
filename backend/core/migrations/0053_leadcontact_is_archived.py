from django.db import migrations, models


def backfill_is_archived_from_status(apps, schema_editor):
    LeadContact = apps.get_model("core", "LeadContact")
    LeadContact.objects.filter(status="archived").update(is_archived=True)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0052_customerrecord_leadcontactrecord_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="leadcontact",
            name="is_archived",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(
            code=backfill_is_archived_from_status,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
