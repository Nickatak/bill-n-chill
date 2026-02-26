from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import Budget, BudgetLine, CostCode
from core.views.helpers import SYSTEM_BUDGET_LINE_SPECS, _ensure_primary_membership


class Command(BaseCommand):
    help = (
        "Backfill system budget lines (tools/overhead/unplanned) onto existing budgets. "
        "Idempotent: skips lines that already exist per budget+cost_code with scope_item=null."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--all-statuses",
            action="store_true",
            help="Include superseded budgets in addition to active budgets.",
        )
        parser.add_argument(
            "--user-id",
            type=int,
            default=None,
            help="Optional created_by user id filter.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        include_all_statuses = bool(options.get("all_statuses"))
        user_id = options.get("user_id")

        budgets = Budget.objects.select_related("created_by", "project").order_by("id")
        if not include_all_statuses:
            budgets = budgets.filter(status=Budget.Status.ACTIVE)
        if user_id is not None:
            budgets = budgets.filter(created_by_id=user_id)

        membership_by_user_id = {}
        scanned_budgets = 0
        touched_budgets = 0
        created_cost_codes = 0
        created_lines = 0
        skipped_existing_lines = 0

        for budget in budgets.iterator():
            scanned_budgets += 1
            creator = budget.created_by
            membership = membership_by_user_id.get(creator.id)
            if membership is None:
                membership = _ensure_primary_membership(creator)
                membership_by_user_id[creator.id] = membership

            budget_touched = False
            for spec in SYSTEM_BUDGET_LINE_SPECS:
                cost_code, cc_created = CostCode.objects.get_or_create(
                    organization_id=membership.organization_id,
                    code=spec["cost_code"],
                    defaults={
                        "name": spec["cost_code_name"],
                        "is_active": True,
                        "created_by": creator,
                    },
                )
                if cc_created:
                    created_cost_codes += 1

                exists = BudgetLine.objects.filter(
                    budget=budget,
                    scope_item__isnull=True,
                    cost_code=cost_code,
                ).exists()
                if exists:
                    skipped_existing_lines += 1
                    continue

                BudgetLine.objects.create(
                    budget=budget,
                    scope_item=None,
                    cost_code=cost_code,
                    description=spec["description"],
                    budget_amount="0.00",
                )
                created_lines += 1
                budget_touched = True

            if budget_touched:
                touched_budgets += 1

        scope_label = "all statuses" if include_all_statuses else "active only"
        self.stdout.write(
            self.style.SUCCESS(
                "System budget line backfill complete: "
                f"scanned_budgets={scanned_budgets}, "
                f"touched_budgets={touched_budgets}, "
                f"created_lines={created_lines}, "
                f"created_cost_codes={created_cost_codes}, "
                f"skipped_existing_lines={skipped_existing_lines}, "
                f"scope={scope_label}"
            )
        )
