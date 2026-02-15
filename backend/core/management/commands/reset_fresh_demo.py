from django.core.management import BaseCommand, call_command


class Command(BaseCommand):
    help = "Reset database to a fresh state and optionally reseed Bob demo data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            default="test@ex.com",
            help="Demo user email used when reseeding.",
        )
        parser.add_argument(
            "--password",
            default="Qweqwe123",
            help="Demo user password used when reseeding.",
        )
        parser.add_argument(
            "--project-name",
            default="Bathroom Remodel (Demo)",
            help="Demo project name used when reseeding.",
        )
        parser.add_argument(
            "--skip-seed",
            action="store_true",
            help="Only flush data; do not reseed demo data.",
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("Flushing all database data..."))
        call_command("flush", interactive=False, verbosity=0)
        self.stdout.write(self.style.SUCCESS("Database reset complete (all data removed)."))

        if options["skip_seed"]:
            self.stdout.write("Skipped reseed. Database is empty and ready.")
            return

        self.stdout.write("Reseeding Bob demo data...")
        call_command(
            "seed_bob_demo",
            email=options["email"],
            password=options["password"],
            project_name=options["project_name"],
            verbosity=1,
        )
        self.stdout.write(self.style.SUCCESS("Fresh demo reset + seed complete."))
