"""Promote payments from project-scoped to org-scoped.

- Add organization FK (nullable first, then backfill from project, then non-nullable).
- Make project FK nullable (payments can exist without a project).
"""

from django.db import migrations, models
import django.db.models.deletion


def backfill_organization(apps, schema_editor):
    """Set organization_id from project.organization_id for all existing payments."""
    Payment = apps.get_model("core", "Payment")
    for payment in Payment.objects.select_related("project").filter(organization__isnull=True):
        payment.organization_id = payment.project.organization_id
        payment.save(update_fields=["organization_id"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0005_impersonation_token"),
    ]

    operations = [
        # Step 1: Add organization FK as nullable
        migrations.AddField(
            model_name="payment",
            name="organization",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="payments",
                to="core.organization",
            ),
        ),
        # Step 2: Backfill organization from project
        migrations.RunPython(backfill_organization, migrations.RunPython.noop),
        # Step 3: Make organization non-nullable
        migrations.AlterField(
            model_name="payment",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="payments",
                to="core.organization",
            ),
        ),
        # Step 4: Make project nullable
        migrations.AlterField(
            model_name="payment",
            name="project",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="payments",
                to="core.project",
            ),
        ),
    ]
