"""RBAC: Add budgets.edit action to owner and PM system RoleTemplates.

Extends the budgets capability from view-only to [view, edit] for owner and PM.
All other roles remain view-only. Closes the ungated budget_line_detail_view PATCH.
"""

from django.db import migrations


BUDGETS_EDIT_BY_ROLE = {
    "owner": ["view", "edit"],
    "pm": ["view", "edit"],
}


def add_budgets_edit(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    for slug, actions in BUDGETS_EDIT_BY_ROLE.items():
        try:
            template = RoleTemplate.objects.get(is_system=True, slug=slug)
        except RoleTemplate.DoesNotExist:
            continue
        caps = template.capability_flags_json or {}
        caps["budgets"] = actions
        template.capability_flags_json = caps
        template.save(update_fields=["capability_flags_json"])


def remove_budgets_edit(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    for slug in BUDGETS_EDIT_BY_ROLE:
        try:
            template = RoleTemplate.objects.get(is_system=True, slug=slug)
        except RoleTemplate.DoesNotExist:
            continue
        caps = template.capability_flags_json or {}
        caps["budgets"] = ["view"]
        template.capability_flags_json = caps
        template.save(update_fields=["capability_flags_json"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_rbac_accounting_sync_resource"),
    ]

    operations = [
        migrations.RunPython(
            add_budgets_edit,
            remove_budgets_edit,
        ),
    ]
