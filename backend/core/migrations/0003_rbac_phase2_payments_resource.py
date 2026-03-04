"""RBAC Phase 2: Add payments resource to system RoleTemplate capability flags.

Adds 'payments' key to capability_flags_json for all 5 system role templates.
- owner, bookkeeping: full payment lifecycle (view, create, edit, allocate)
- pm, worker, viewer: view only
"""

from django.db import migrations


PAYMENTS_BY_ROLE = {
    "owner": ["view", "create", "edit", "allocate"],
    "pm": ["view"],
    "worker": ["view"],
    "bookkeeping": ["view", "create", "edit", "allocate"],
    "viewer": ["view"],
}


def add_payments_resource(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    for slug, actions in PAYMENTS_BY_ROLE.items():
        try:
            template = RoleTemplate.objects.get(is_system=True, slug=slug)
        except RoleTemplate.DoesNotExist:
            continue
        caps = template.capability_flags_json or {}
        caps["payments"] = actions
        template.capability_flags_json = caps
        template.save(update_fields=["capability_flags_json"])


def remove_payments_resource(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    for slug in PAYMENTS_BY_ROLE:
        try:
            template = RoleTemplate.objects.get(is_system=True, slug=slug)
        except RoleTemplate.DoesNotExist:
            continue
        caps = template.capability_flags_json or {}
        caps.pop("payments", None)
        template.capability_flags_json = caps
        template.save(update_fields=["capability_flags_json"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_rbac_phase1"),
    ]

    operations = [
        migrations.RunPython(
            add_payments_resource,
            remove_payments_resource,
        ),
    ]
