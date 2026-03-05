from django.core.management.base import BaseCommand, CommandError

from core.models import CostCode, Organization, OrganizationMembership


def _resolve_created_by_for_org(organization: Organization):
    if organization.created_by_id:
        return organization.created_by
    membership = (
        OrganizationMembership.objects.filter(
            organization=organization,
            status=OrganizationMembership.Status.ACTIVE,
        )
        .select_related("user")
        .order_by("id")
        .first()
    )
    return membership.user if membership else None


class Command(BaseCommand):
    help = "Seed default cost-code catalog into one or more organizations."

    def add_arguments(self, parser):
        parser.add_argument(
            "--org-id",
            action="append",
            type=int,
            dest="org_ids",
            help="Organization id to seed. Repeat for multiple ids.",
        )
        parser.add_argument(
            "--all-orgs",
            action="store_true",
            help="Seed all organizations.",
        )

    def handle(self, *args, **options):
        org_ids = options.get("org_ids") or []
        all_orgs = bool(options.get("all_orgs"))
        if not all_orgs and not org_ids:
            raise CommandError("Provide --org-id (repeatable) or --all-orgs.")

        if all_orgs:
            organizations = Organization.objects.all().order_by("id")
        else:
            organizations = Organization.objects.filter(id__in=org_ids).order_by("id")

        if not organizations.exists():
            raise CommandError("No matching organizations found.")

        total_created = 0

        for organization in organizations:
            created_by = _resolve_created_by_for_org(organization)
            if not created_by:
                self.stderr.write(
                    self.style.WARNING(
                        f"Skipped org #{organization.id} ({organization.display_name}): no user available for created_by."
                    )
                )
                continue

            org_created = CostCode.seed_defaults(
                organization=organization, created_by=created_by,
            )
            total_created += org_created
            self.stdout.write(
                self.style.SUCCESS(
                    f"Org #{organization.id} ({organization.display_name}): created={org_created}"
                )
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Default cost-code seed complete. created={total_created}"
            )
        )
