from django.core.management.base import BaseCommand

from core.models import Customer


class Command(BaseCommand):
    help = "Backfill missing customer display names using source leads or fallbacks."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would change without writing updates.",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        updated = 0
        scanned = 0

        for customer in Customer.objects.all():
            scanned += 1
            display_name = (customer.display_name or "").strip()
            if display_name:
                continue

            if customer.email:
                candidate = customer.email.strip()
            elif customer.phone:
                candidate = customer.phone.strip()
            else:
                candidate = f"Customer #{customer.id}"

            if not candidate:
                candidate = f"Customer #{customer.id}"

            if dry_run:
                self.stdout.write(
                    f"Would update Customer #{customer.id} display_name -> {candidate}"
                )
            else:
                customer.display_name = candidate
                customer.save(update_fields=["display_name", "updated_at"])
            updated += 1

        if dry_run:
            self.stdout.write(
                f"Dry run complete. Scanned {scanned} customers. Would update {updated}."
            )
        else:
            self.stdout.write(
                f"Backfill complete. Scanned {scanned} customers. Updated {updated}."
            )
