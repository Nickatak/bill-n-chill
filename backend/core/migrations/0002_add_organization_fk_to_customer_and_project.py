"""Add organization FK to Customer and Project models.

Replaces the indirect ``created_by`` → ``OrganizationMembership`` → organization
scoping with a direct FK for single-query tenant isolation.

Three-phase migration:
1. Add nullable organization FK to both models.
2. Backfill from each row's created_by user's active membership.
3. Make the FK non-nullable.
"""

from django.db import migrations, models
import django.db.models.deletion


def backfill_organization(apps, schema_editor):
    """Derive organization_id from created_by's active OrganizationMembership."""
    OrganizationMembership = apps.get_model("core", "OrganizationMembership")
    Customer = apps.get_model("core", "Customer")
    Project = apps.get_model("core", "Project")

    # Build user_id → organization_id mapping from active memberships
    user_to_org = dict(
        OrganizationMembership.objects.filter(status="active").values_list(
            "user_id", "organization_id"
        )
    )

    for Model in (Customer, Project):
        rows = Model.objects.filter(organization__isnull=True).select_related()
        for row in rows:
            org_id = user_to_org.get(row.created_by_id)
            if org_id:
                row.organization_id = org_id
                row.save(update_fields=["organization_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        # Phase 1: Add nullable FK
        migrations.AddField(
            model_name="customer",
            name="organization",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="customers",
                to="core.organization",
            ),
        ),
        migrations.AddField(
            model_name="project",
            name="organization",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="projects",
                to="core.organization",
            ),
        ),
        # Phase 2: Backfill
        migrations.RunPython(backfill_organization, migrations.RunPython.noop),
        # Phase 3: Make non-nullable
        migrations.AlterField(
            model_name="customer",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="customers",
                to="core.organization",
            ),
        ),
        migrations.AlterField(
            model_name="project",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="projects",
                to="core.organization",
            ),
        ),
    ]
