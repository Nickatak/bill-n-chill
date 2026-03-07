import importlib

from django.core.management import BaseCommand, call_command
from django.db import transaction

from core.models import RoleTemplate


class Command(BaseCommand):
    help = "Reset database to a fresh state and optionally reseed demo data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--skip-seed",
            action="store_true",
            help="Only flush data; do not reseed demo data.",
        )

    @transaction.atomic
    def _seed_system_role_templates(self):
        """Ensure system RoleTemplate rows exist after flush.

        These are infrastructure, not demo data — every org needs them
        for RBAC capability resolution to work.
        """
        migration_mod = importlib.import_module("core.migrations.0002_rbac_phase1")
        payments_mod = importlib.import_module("core.migrations.0003_rbac_phase2_payments_resource")
        SYSTEM_ROLES = migration_mod.SYSTEM_ROLES
        PAYMENTS_BY_ROLE = payments_mod.PAYMENTS_BY_ROLE

        for slug, data in SYSTEM_ROLES.items():
            caps = dict(data["capability_flags_json"])
            if slug in PAYMENTS_BY_ROLE:
                caps["payments"] = PAYMENTS_BY_ROLE[slug]
            RoleTemplate.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": data["name"],
                    "is_system": True,
                    "capability_flags_json": caps,
                    "created_by": None,
                },
            )
        self.stdout.write(f"  System RoleTemplates: {len(SYSTEM_ROLES)} ensured")

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("Flushing all database data..."))
        call_command("flush", interactive=False, verbosity=0)
        self.stdout.write(self.style.SUCCESS("Database reset complete (all data removed)."))

        # Always reseed system role templates — they're infrastructure.
        self._seed_system_role_templates()

        if options["skip_seed"]:
            self.stdout.write("Skipped demo reseed. Database is clean + RBAC ready.")
            return

        self.stdout.write("Reseeding adoption-stage demo data...")
        call_command("seed_adoption_stages", verbosity=1)
        self.stdout.write(self.style.SUCCESS("Fresh demo reset + seed complete."))
