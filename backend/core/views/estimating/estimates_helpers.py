"""Domain-specific helpers for estimate views."""

from decimal import Decimal

from django.db.models import Q

from core.models import (
    Budget,
    BudgetLine,
    CostCode,
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    FinancialAuditEvent,
    Project,
    ScopeItem,
)
from core.serializers import EstimateSerializer
from core.user_helpers import _ensure_membership
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import (
    SYSTEM_BUDGET_LINE_SPECS,
    _organization_user_ids,
)


def _build_public_estimate_decision_note(
    *,
    action_label: str,
    note: str,
    decider_name: str,
    decider_email: str,
) -> str:
    actor_parts = [part for part in [decider_name.strip(), decider_email.strip()] if part]
    actor_label = " / ".join(actor_parts) if actor_parts else "anonymous customer"
    note_value = note.strip()
    if note_value:
        return f"{action_label} via public link by {actor_label}. {note_value}"
    return f"{action_label} via public link by {actor_label}."


def _archive_estimate_family(*, project, user, title, exclude_ids, note):
    normalized_title = (title or "").strip()
    if not normalized_title:
        return
    actor_user_ids = _organization_user_ids(user)

    candidates = (
        Estimate.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
            title=normalized_title,
        )
        .exclude(id__in=exclude_ids)
        .exclude(status=Estimate.Status.ARCHIVED)
    )
    for candidate in candidates:
        if not Estimate.is_transition_allowed(
            current_status=candidate.status,
            next_status=Estimate.Status.ARCHIVED,
        ):
            continue
        previous_status = candidate.status
        candidate.status = Estimate.Status.ARCHIVED
        candidate.save(update_fields=["status", "updated_at"])
        EstimateStatusEvent.record(
            estimate=candidate,
            from_status=previous_status,
            to_status=Estimate.Status.ARCHIVED,
            note=note,
            changed_by=user,
        )


def _next_estimate_family_version(*, project, user, title):
    normalized_title = (title or "").strip()
    actor_user_ids = _organization_user_ids(user)
    latest = (
        Estimate.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
            title=normalized_title,
        )
        .order_by("-version")
        .first()
    )
    return (latest.version + 1) if latest else 1


def _active_budget_for_project(*, project, actor_user_ids):
    return (
        Budget.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
            status=Budget.Status.ACTIVE,
        )
        .select_related("source_estimate")
        .order_by("-created_at", "-id")
        .first()
    )


def _estimate_financial_baseline_context(*, project, actor_user_ids):
    budgets = (
        Budget.objects.filter(project=project, created_by_id__in=actor_user_ids)
        .select_related("source_estimate")
        .order_by("-created_at", "-id")
    )
    financial_baseline_status_by_estimate_id: dict[int, str] = {}
    active_budget = None
    for budget in budgets:
        source_estimate_id = budget.source_estimate_id
        if source_estimate_id is None:
            continue
        if budget.status == Budget.Status.ACTIVE:
            if source_estimate_id not in financial_baseline_status_by_estimate_id:
                financial_baseline_status_by_estimate_id[source_estimate_id] = "active"
            if active_budget is None:
                active_budget = budget
            continue
        if source_estimate_id not in financial_baseline_status_by_estimate_id:
            financial_baseline_status_by_estimate_id[source_estimate_id] = "superseded"
    return {
        "financial_baseline_status_by_estimate_id": financial_baseline_status_by_estimate_id,
        "active_budget_id": active_budget.id if active_budget else None,
        "active_budget_source_estimate_id": active_budget.source_estimate_id if active_budget else None,
        "active_budget_source_estimate_version": (
            active_budget.source_estimate.version
            if active_budget and active_budget.source_estimate_id
            else None
        ),
    }


def _serialize_estimate(*, estimate, actor_user_ids):
    context = _estimate_financial_baseline_context(
        project=estimate.project,
        actor_user_ids=actor_user_ids,
    )
    return EstimateSerializer(estimate, context=context).data


def _serialize_estimates(*, estimates, project, actor_user_ids):
    context = _estimate_financial_baseline_context(
        project=project,
        actor_user_ids=actor_user_ids,
    )
    return EstimateSerializer(estimates, many=True, context=context).data


def _sync_project_contract_baseline_if_unset(*, estimate):
    project = estimate.project
    if project.contract_value_original != Decimal("0") or project.contract_value_current != Decimal("0"):
        return False
    project.contract_value_original = estimate.grand_total
    project.contract_value_current = estimate.grand_total
    project.save(update_fields=["contract_value_original", "contract_value_current", "updated_at"])
    return True


def _activate_project_from_estimate_approval(*, estimate, actor, note: str):
    project = estimate.project
    if project.status not in (Project.Status.PROSPECT, Project.Status.ON_HOLD):
        return False
    if not Project.is_transition_allowed(project.status, Project.Status.ACTIVE):
        return False

    previous_status = project.status
    project.status = Project.Status.ACTIVE
    project.save(update_fields=["status", "updated_at"])
    FinancialAuditEvent.record(
        project=project,
        event_type="project_status_changed",
        object_type="project",
        object_id=project.id,
        from_status=previous_status,
        to_status=project.status,
        note=note,
        created_by=actor,
        metadata={
            "trigger": "estimate_approved",
            "estimate_id": estimate.id,
            "estimate_version": estimate.version,
        },
    )
    return True


def _ensure_budget_from_approved_estimate(
    *,
    estimate,
    user,
    note: str,
    allow_supersede: bool = False,
):
    _sync_project_contract_baseline_if_unset(estimate=estimate)
    actor_user_ids = _organization_user_ids(user)
    existing = (
        Budget.objects.filter(source_estimate=estimate, created_by_id__in=actor_user_ids)
        .select_related("source_estimate")
        .prefetch_related("line_items", "line_items__cost_code")
        .order_by("-created_at", "-id")
        .first()
    )
    if existing and existing.status == Budget.Status.ACTIVE:
        return existing, "already_converted"

    active_budget = _active_budget_for_project(project=estimate.project, actor_user_ids=actor_user_ids)
    active_budget_conflict = (
        active_budget is not None
        and active_budget.source_estimate_id is not None
        and active_budget.source_estimate_id != estimate.id
    )
    if active_budget_conflict and not allow_supersede:
        return active_budget, "requires_supersede"

    budget = _create_budget_from_estimate(estimate=estimate, user=user)
    budget = (
        Budget.objects.filter(id=budget.id)
        .select_related("source_estimate")
        .prefetch_related("line_items", "line_items__cost_code")
        .get()
    )
    FinancialAuditEvent.record(
        project=estimate.project,
        event_type=FinancialAuditEvent.EventType.BUDGET_CONVERTED,
        object_type="budget",
        object_id=budget.id,
        to_status=budget.status,
        amount=estimate.grand_total,
        note=note,
        created_by=user,
        metadata={
            "estimate_id": estimate.id,
            "estimate_version": estimate.version,
            "activation_mode": "supersede_active"
            if active_budget_conflict and allow_supersede
            else "initial_or_no_conflict",
        },
    )
    if active_budget_conflict and allow_supersede:
        return budget, "superseded_and_converted"
    return budget, "converted"


def _calculate_line_totals(line_items_data):
    subtotal = MONEY_ZERO
    markup_total = MONEY_ZERO
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_cost = Decimal(str(item["unit_cost"]))
        markup_percent = Decimal(str(item.get("markup_percent", 0)))
        # Markup can be applied before or after quantity multiplication:
        # q * u * (1 + m) == q * (u * (1 + m))
        base_total = quantize_money(quantity * unit_cost)
        line_markup = quantize_money(base_total * (markup_percent / Decimal("100")))
        line_total = quantize_money(base_total + line_markup)
        subtotal = quantize_money(subtotal + base_total)
        markup_total = quantize_money(markup_total + line_markup)
        normalized_items.append(
            {
                **item,
                "quantity": quantity,
                "unit_cost": unit_cost,
                "markup_percent": markup_percent,
                "line_total": line_total,
            }
        )

    return normalized_items, subtotal, markup_total


def _resolve_cost_codes_for_user(user, line_items_data):
    ids = [item["cost_code"] for item in line_items_data]
    membership = _ensure_membership(user)
    actor_user_ids = _organization_user_ids(user)
    codes = CostCode.objects.filter(
        id__in=ids,
    ).filter(
        Q(organization_id=membership.organization_id) | Q(
            organization__isnull=True,
            created_by_id__in=actor_user_ids,
        )
    )
    code_map = {code.id: code for code in codes}
    missing = [cost_code_id for cost_code_id in ids if cost_code_id not in code_map]
    return code_map, missing


def _apply_estimate_lines_and_totals(estimate, line_items_data, tax_percent, user):
    normalized_items, subtotal, markup_total = _calculate_line_totals(line_items_data)
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}
    membership = _ensure_membership(user)

    tax_percent = Decimal(str(tax_percent))
    tax_total = quantize_money((subtotal + markup_total) * (tax_percent / Decimal("100")))
    grand_total = quantize_money(subtotal + markup_total + tax_total)

    estimate.line_items.all().delete()
    new_lines = []
    for item in normalized_items:
        description = (item.get("description") or "").strip()
        normalized_scope_name = " ".join(description.lower().split())
        unit_value = (item.get("unit") or "ea").strip().lower() or "ea"
        scope_item = None
        if normalized_scope_name:
            scope_item = (
                ScopeItem.objects.filter(
                    organization_id=membership.organization_id,
                    cost_code=code_map[item["cost_code"]],
                    normalized_name=normalized_scope_name,
                    unit=unit_value,
                )
                .order_by("id")
                .first()
            )
            if not scope_item:
                scope_item = ScopeItem.objects.create(
                    organization_id=membership.organization_id,
                    cost_code=code_map[item["cost_code"]],
                    name=description[:255],
                    normalized_name=normalized_scope_name,
                    unit=unit_value,
                    created_by=user,
                )

        new_lines.append(
            EstimateLineItem(
                estimate=estimate,
                scope_item=scope_item,
                cost_code=code_map[item["cost_code"]],
                description=description,
                quantity=item["quantity"],
                unit=unit_value,
                unit_cost=item["unit_cost"],
                markup_percent=item["markup_percent"],
                line_total=item["line_total"],
            )
        )
    EstimateLineItem.objects.bulk_create(new_lines)

    estimate.subtotal = subtotal
    estimate.markup_total = markup_total
    estimate.tax_percent = tax_percent
    estimate.tax_total = tax_total
    estimate.grand_total = grand_total
    estimate.save(
        update_fields=[
            "subtotal",
            "markup_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "updated_at",
        ]
    )
    return None


def _build_budget_baseline_snapshot(estimate):
    return {
        "estimate": {
            "id": estimate.id,
            "project_id": estimate.project_id,
            "version": estimate.version,
            "status": estimate.status,
            "title": estimate.title,
            "subtotal": str(estimate.subtotal),
            "markup_total": str(estimate.markup_total),
            "tax_percent": str(estimate.tax_percent),
            "tax_total": str(estimate.tax_total),
            "grand_total": str(estimate.grand_total),
            "created_at": estimate.created_at.isoformat(),
            "updated_at": estimate.updated_at.isoformat(),
        },
        "line_items": [
            {
                "estimate_line_item_id": line.id,
                "scope_item_id": line.scope_item_id,
                "cost_code_id": line.cost_code_id,
                "cost_code_code": line.cost_code.code,
                "cost_code_name": line.cost_code.name,
                "description": line.description,
                "quantity": str(line.quantity),
                "unit": line.unit,
                "unit_cost": str(line.unit_cost),
                "markup_percent": str(line.markup_percent),
                "line_total": str(line.line_total),
            }
            for line in estimate.line_items.all()
        ],
    }


def _supersede_active_project_budgets(*, project, user, superseded_by_estimate=None):
    actor_user_ids = _organization_user_ids(user)
    active_budgets = Budget.objects.filter(
        project=project,
        created_by_id__in=actor_user_ids,
        status=Budget.Status.ACTIVE,
    ).select_related("source_estimate")
    for budget in active_budgets:
        previous_status = budget.status
        budget.status = Budget.Status.SUPERSEDED
        budget.save(update_fields=["status", "updated_at"])
        superseded_by_label = ""
        metadata = {
            "superseded_budget_id": budget.id,
            "superseded_source_estimate_id": budget.source_estimate_id,
            "superseded_source_estimate_version": budget.source_estimate.version,
        }
        if superseded_by_estimate is not None:
            superseded_by_label = (
                f" by estimate #{superseded_by_estimate.id} (v{superseded_by_estimate.version})"
            )
            metadata["superseded_by_estimate_id"] = superseded_by_estimate.id
            metadata["superseded_by_estimate_version"] = superseded_by_estimate.version
        FinancialAuditEvent.record(
            project=project,
            event_type=FinancialAuditEvent.EventType.BUDGET_CONVERTED,
            object_type="budget",
            object_id=budget.id,
            from_status=previous_status,
            to_status=budget.status,
            amount=budget.source_estimate.grand_total if budget.source_estimate_id else None,
            note=f"Budget #{budget.id} superseded{superseded_by_label}.",
            created_by=user,
            metadata=metadata,
        )


def _create_budget_from_estimate(*, estimate, user):
    _supersede_active_project_budgets(
        project=estimate.project,
        user=user,
        superseded_by_estimate=estimate,
    )
    budget = Budget.objects.create(
        project=estimate.project,
        status=Budget.Status.ACTIVE,
        source_estimate=estimate,
        baseline_snapshot_json=_build_budget_baseline_snapshot(estimate),
        created_by=user,
    )

    budget_lines = [
        BudgetLine(
            budget=budget,
            scope_item=line.scope_item,
            cost_code=line.cost_code,
            description=line.description,
            budget_amount=line.line_total,
        )
        for line in estimate.line_items.all()
    ]

    membership = _ensure_membership(user)
    for spec in SYSTEM_BUDGET_LINE_SPECS:
        cost_code, _created = CostCode.objects.get_or_create(
            organization_id=membership.organization_id,
            code=spec["cost_code"],
            defaults={
                "name": spec["cost_code_name"],
                "is_active": True,
                "created_by": user,
            },
        )
        budget_lines.append(
            BudgetLine(
                budget=budget,
                scope_item=None,
                cost_code=cost_code,
                description=spec["description"],
                budget_amount=Decimal("0.00"),
            )
        )

    BudgetLine.objects.bulk_create(budget_lines)
    return budget
