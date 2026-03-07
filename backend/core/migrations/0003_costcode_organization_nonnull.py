"""Make CostCode.organization non-nullable.

Phase 1: Backfill any null-org cost codes from created_by's active membership.
Phase 2: AlterField to remove null=True.
"""

from django.db import migrations, models
import django.db.models.deletion


def backfill_costcode_organization(apps, schema_editor):
    CostCode = apps.get_model("core", "CostCode")
    OrganizationMembership = apps.get_model("core", "OrganizationMembership")

    null_org_codes = CostCode.objects.filter(organization__isnull=True)
    for code in null_org_codes:
        membership = (
            OrganizationMembership.objects.filter(
                user_id=code.created_by_id,
                status="active",
            )
            .first()
        )
        if membership:
            code.organization_id = membership.organization_id
            code.save(update_fields=["organization_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_add_organization_fk_to_customer_and_project"),
    ]

    operations = [
        migrations.RunPython(
            backfill_costcode_organization,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name="costcode",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="cost_codes",
                to="core.organization",
            ),
        ),
    ]
