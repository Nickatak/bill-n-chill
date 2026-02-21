from django.conf import settings
from django.db import migrations
from django.utils.text import slugify


def _backfill_memberships(apps, _schema_editor):
    app_label, model_name = settings.AUTH_USER_MODEL.split(".")
    User = apps.get_model(app_label, model_name)
    Organization = apps.get_model("core", "Organization")
    OrganizationMembership = apps.get_model("core", "OrganizationMembership")

    for user in User.objects.all().iterator():
        if OrganizationMembership.objects.filter(user_id=user.id).exists():
            continue

        raw_seed = ((getattr(user, "email", "") or getattr(user, "username", "") or f"user-{user.id}").split("@")[0]).strip()
        base_slug = slugify(raw_seed) or f"org-{user.id}"
        slug_candidate = base_slug
        suffix = 2
        while Organization.objects.filter(slug=slug_candidate).exists():
            slug_candidate = f"{base_slug}-{suffix}"
            suffix += 1

        humanized = raw_seed.replace(".", " ").replace("_", " ").replace("-", " ").strip().title()
        display_name = f"{humanized or 'New'} Organization"
        organization = Organization.objects.create(
            display_name=display_name,
            slug=slug_candidate,
            created_by_id=user.id,
        )
        OrganizationMembership.objects.create(
            organization_id=organization.id,
            user_id=user.id,
            role="owner",
            status="active",
            capability_flags_json={},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0028_organization_organizationmembership"),
    ]

    operations = [
        migrations.RunPython(_backfill_memberships, migrations.RunPython.noop),
    ]
