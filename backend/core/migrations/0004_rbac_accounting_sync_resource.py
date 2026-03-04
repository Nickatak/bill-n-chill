"""RBAC: Add accounting_sync resource to system RoleTemplate capability flags.

Adds 'accounting_sync' key to capability_flags_json for all 5 system role templates.
- owner, bookkeeping: full access (view, create, retry)
- pm, worker, viewer: view only
"""

from django.db import migrations


ACCOUNTING_SYNC_BY_ROLE = {
    "owner": ["view", "create", "retry"],
    "pm": ["view"],
    "worker": ["view"],
    "bookkeeping": ["view", "create", "retry"],
    "viewer": ["view"],
}


def add_accounting_sync_resource(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    for slug, actions in ACCOUNTING_SYNC_BY_ROLE.items():
        try:
            template = RoleTemplate.objects.get(is_system=True, slug=slug)
        except RoleTemplate.DoesNotExist:
            continue
        caps = template.capability_flags_json or {}
        caps["accounting_sync"] = actions
        template.capability_flags_json = caps
        template.save(update_fields=["capability_flags_json"])


def remove_accounting_sync_resource(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    for slug in ACCOUNTING_SYNC_BY_ROLE:
        try:
            template = RoleTemplate.objects.get(is_system=True, slug=slug)
        except RoleTemplate.DoesNotExist:
            continue
        caps = template.capability_flags_json or {}
        caps.pop("accounting_sync", None)
        template.capability_flags_json = caps
        template.save(update_fields=["capability_flags_json"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_rbac_phase2_payments_resource"),
    ]

    operations = [
        migrations.RunPython(
            add_accounting_sync_resource,
            remove_accounting_sync_resource,
        ),
    ]
