import secrets
import string

from django.db import migrations, models


def _generate_public_token(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def backfill_invoice_public_tokens(apps, schema_editor):
    Invoice = apps.get_model("core", "Invoice")
    for invoice in Invoice.objects.filter(public_token__isnull=True).iterator():
        while True:
            candidate = _generate_public_token()
            if not Invoice.objects.filter(public_token=candidate).exists():
                invoice.public_token = candidate
                invoice.save(update_fields=["public_token"])
                break


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0008_organization_estimate_validation_delta_days"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="public_token",
            field=models.CharField(blank=True, max_length=24, null=True, unique=True),
        ),
        migrations.RunPython(backfill_invoice_public_tokens, migrations.RunPython.noop),
    ]
