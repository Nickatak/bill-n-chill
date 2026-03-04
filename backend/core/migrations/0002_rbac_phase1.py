"""RBAC Phase 1: Org model cleanup, RoleTemplate capability flags, drop Permission models.

- Rename 6 Organization fields to cleaner names
- Drop 6 Organization fields (slug, invoice_sender_name/email, CO reason, invoice footer/notes)
- Add capability_flags_json to RoleTemplate
- Drop RoleTemplatePermission and Permission models (unused scaffolds)
- Seed 5 system RoleTemplate rows with permission matrix
"""

from django.db import migrations, models


SYSTEM_ROLES = {
    "owner": {
        "name": "Owner",
        "description": "Full access to everything.",
        "capability_flags_json": {
            "estimates": ["view", "create", "edit", "approve", "send"],
            "change_orders": ["view", "create", "edit", "approve", "send"],
            "invoices": ["view", "create", "edit", "approve", "send"],
            "vendor_bills": ["view", "create", "edit", "approve", "pay"],
            "projects": ["view", "create", "edit"],
            "customers": ["view", "create", "edit", "disable"],
            "cost_codes": ["view", "create", "edit", "disable"],
            "vendors": ["view", "create", "edit", "disable"],
            "budgets": ["view"],
            "org_identity": ["view", "edit"],
            "org_presets": ["view", "edit"],
            "users": ["view", "invite", "edit_role", "disable"],
            "financial_audit": ["view"],
        },
    },
    "pm": {
        "name": "Project Manager",
        "description": "Full access except org identity editing.",
        "capability_flags_json": {
            "estimates": ["view", "create", "edit", "approve", "send"],
            "change_orders": ["view", "create", "edit", "approve", "send"],
            "invoices": ["view", "create", "edit", "approve", "send"],
            "vendor_bills": ["view", "create", "edit", "approve", "pay"],
            "projects": ["view", "create", "edit"],
            "customers": ["view", "create", "edit", "disable"],
            "cost_codes": ["view", "create", "edit", "disable"],
            "vendors": ["view", "create", "edit", "disable"],
            "budgets": ["view"],
            "org_identity": ["view"],
            "org_presets": ["view", "edit"],
            "users": ["view", "invite", "edit_role", "disable"],
            "financial_audit": ["view"],
        },
    },
    "worker": {
        "name": "Worker",
        "description": "Day-to-day document work. No approve, pay, disable, or user management.",
        "capability_flags_json": {
            "estimates": ["view", "create", "edit", "send"],
            "change_orders": ["view", "create", "edit", "send"],
            "invoices": ["view", "create", "edit", "send"],
            "vendor_bills": ["view", "create", "edit"],
            "projects": ["view", "create", "edit"],
            "customers": ["view", "create", "edit"],
            "cost_codes": ["view", "create", "edit"],
            "vendors": ["view", "create", "edit"],
            "budgets": ["view"],
            "org_identity": ["view"],
            "org_presets": ["view"],
            "users": [],
            "financial_audit": ["view"],
        },
    },
    "bookkeeping": {
        "name": "Bookkeeping",
        "description": "Financial record-keeper. Full vendor bills, invoices without send.",
        "capability_flags_json": {
            "estimates": ["view"],
            "change_orders": ["view"],
            "invoices": ["view", "create", "edit"],
            "vendor_bills": ["view", "create", "edit", "approve", "pay"],
            "projects": ["view"],
            "customers": ["view"],
            "cost_codes": ["view", "create", "edit"],
            "vendors": ["view", "create", "edit"],
            "budgets": ["view"],
            "org_identity": ["view"],
            "org_presets": ["view"],
            "users": [],
            "financial_audit": ["view"],
        },
    },
    "viewer": {
        "name": "Viewer",
        "description": "Read-only access across all resources.",
        "capability_flags_json": {
            "estimates": ["view"],
            "change_orders": ["view"],
            "invoices": ["view"],
            "vendor_bills": ["view"],
            "projects": ["view"],
            "customers": ["view"],
            "cost_codes": ["view"],
            "vendors": ["view"],
            "budgets": ["view"],
            "org_identity": ["view"],
            "org_presets": ["view"],
            "users": [],
            "financial_audit": ["view"],
        },
    },
}


def seed_system_role_templates(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    for slug, data in SYSTEM_ROLES.items():
        RoleTemplate.objects.update_or_create(
            slug=slug,
            defaults={
                "name": data["name"],
                "is_system": True,
                "organization": None,
                "capability_flags_json": data["capability_flags_json"],
                "description": data["description"],
                "created_by": None,
            },
        )


def unseed_system_role_templates(apps, schema_editor):
    RoleTemplate = apps.get_model("core", "RoleTemplate")
    RoleTemplate.objects.filter(is_system=True, slug__in=SYSTEM_ROLES.keys()).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        # --- Organization field renames ---
        migrations.RenameField(
            model_name="organization",
            old_name="invoice_sender_address",
            new_name="billing_address",
        ),
        migrations.RenameField(
            model_name="organization",
            old_name="invoice_default_due_days",
            new_name="default_invoice_due_delta",
        ),
        migrations.RenameField(
            model_name="organization",
            old_name="estimate_validation_delta_days",
            new_name="default_estimate_valid_delta",
        ),
        migrations.RenameField(
            model_name="organization",
            old_name="invoice_default_terms",
            new_name="invoice_terms_and_conditions",
        ),
        migrations.RenameField(
            model_name="organization",
            old_name="estimate_default_terms",
            new_name="estimate_terms_and_conditions",
        ),
        migrations.RenameField(
            model_name="organization",
            old_name="change_order_default_terms",
            new_name="change_order_terms_and_conditions",
        ),
        # --- Organization field drops ---
        migrations.RemoveField(
            model_name="organization",
            name="slug",
        ),
        migrations.RemoveField(
            model_name="organization",
            name="invoice_sender_name",
        ),
        migrations.RemoveField(
            model_name="organization",
            name="invoice_sender_email",
        ),
        migrations.RemoveField(
            model_name="organization",
            name="change_order_default_reason",
        ),
        migrations.RemoveField(
            model_name="organization",
            name="invoice_default_footer",
        ),
        migrations.RemoveField(
            model_name="organization",
            name="invoice_default_notes",
        ),
        # --- RoleTemplate: add capability_flags_json ---
        migrations.AddField(
            model_name="roletemplate",
            name="capability_flags_json",
            field=models.JSONField(blank=True, default=dict),
        ),
        # --- Drop unused scaffold models (RoleTemplatePermission first due to FK) ---
        migrations.DeleteModel(
            name="RoleTemplatePermission",
        ),
        migrations.DeleteModel(
            name="Permission",
        ),
        # --- Seed system role templates ---
        migrations.RunPython(
            seed_system_role_templates,
            unseed_system_role_templates,
        ),
    ]
