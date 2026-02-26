import secrets
import string

from django.db import migrations, models


def _generate_public_token(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def backfill_change_order_public_tokens(apps, schema_editor):
    ChangeOrder = apps.get_model("core", "ChangeOrder")
    for change_order in ChangeOrder.objects.filter(public_token__isnull=True).iterator():
        while True:
            candidate = _generate_public_token()
            if not ChangeOrder.objects.filter(public_token=candidate).exists():
                change_order.public_token = candidate
                change_order.save(update_fields=["public_token"])
                break


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0009_invoice_public_token"),
    ]

    operations = [
        migrations.AddField(
            model_name="changeorder",
            name="public_token",
            field=models.CharField(blank=True, max_length=24, null=True, unique=True),
        ),
        migrations.RunPython(backfill_change_order_public_tokens, migrations.RunPython.noop),
    ]
