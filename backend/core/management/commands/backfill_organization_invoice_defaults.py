from django.core.management.base import BaseCommand

from core.models import Organization
from core.utils.organization_defaults import apply_missing_org_defaults


class Command(BaseCommand):
    help = "Backfill missing organization defaults (T&C, deltas, help email)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report pending updates without writing changes.",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        scanned = 0
        updated = 0

        organizations = Organization.objects.select_related("created_by").order_by("id")
        for organization in organizations:
            scanned += 1
            changed_fields = apply_missing_org_defaults(
                organization=organization,
                owner_email=organization.created_by.email or "",
            )
            if not changed_fields:
                continue

            updated += 1
            if dry_run:
                self.stdout.write(
                    f"Would update Organization #{organization.id} "
                    f"({organization.display_name}): {', '.join(changed_fields)}"
                )
                continue

            organization.save(update_fields=[*changed_fields, "updated_at"])
            self.stdout.write(
                f"Updated Organization #{organization.id} "
                f"({organization.display_name}): {', '.join(changed_fields)}"
            )

        if dry_run:
            self.stdout.write(
                f"Dry run complete. Scanned {scanned} organizations. Would update {updated}."
            )
        else:
            self.stdout.write(
                f"Backfill complete. Scanned {scanned} organizations. Updated {updated}."
            )
