from django.core.management import BaseCommand, call_command

from core.utils.runtime_metadata import write_last_data_reset_at


class Command(BaseCommand):
    help = "Reset database to a fresh state and optionally reseed demo data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--skip-seed",
            action="store_true",
            help="Only flush data; do not reseed demo data.",
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("Flushing all database data..."))
        call_command("flush", interactive=False, verbosity=0)
        reset_at = write_last_data_reset_at()
        self.stdout.write(
            self.style.SUCCESS(
                f"Database reset complete (all data removed). Last reset marker updated: {reset_at}"
            )
        )

        if options["skip_seed"]:
            self.stdout.write("Skipped reseed. Database is empty and ready.")
            return

        self.stdout.write("Reseeding adoption-stage demo data...")
        call_command("seed_adoption_stages", verbosity=1)
        self.stdout.write(
            self.style.SUCCESS(f"Fresh demo reset + seed complete. Last reset marker: {reset_at}")
        )
