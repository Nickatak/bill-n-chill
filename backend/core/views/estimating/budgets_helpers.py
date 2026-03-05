"""Domain-specific helpers for budget creation and lifecycle management."""

from decimal import Decimal

from core.models import (
    Budget,
    BudgetLine,
    CostCode,
    FinancialAuditEvent,
)
from core.user_helpers import _ensure_membership
from core.views.helpers import (
    SYSTEM_BUDGET_LINE_SPECS,
    _active_budget_for_project,
    _organization_user_ids,
)


def _build_budget_baseline_snapshot(estimate):
    """Serialize an estimate and its line items into an immutable baseline snapshot dict.

    Stored as ``Budget.baseline_snapshot_json`` to preserve the financial state
    of the source estimate at the moment of budget conversion.
    """
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
    """Mark all active budgets for a project as superseded.

    Records a ``FinancialAuditEvent`` for each superseded budget.  When
    *superseded_by_estimate* is provided, the audit metadata includes the
    estimate that triggered the supersession.
    """
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
    """Create a new active budget from an approved estimate.

    Supersedes any existing active budgets for the project, then creates
    budget line items from estimate lines plus system overhead lines.
    """
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


def _ensure_budget_from_approved_estimate(
    *,
    estimate,
    user,
    note: str,
    allow_supersede: bool = False,
):
    """Idempotently convert an approved estimate into an active budget.

    Returns ``(budget, status_label)`` where *status_label* is one of:
    ``"already_converted"``, ``"requires_supersede"``, ``"converted"``,
    or ``"superseded_and_converted"``.

    When *allow_supersede* is ``False`` and another estimate's budget is
    already active, returns the existing active budget with
    ``"requires_supersede"`` so the caller can prompt for confirmation.
    """
    from core.views.estimating.estimates_helpers import _sync_project_contract_baseline_if_unset

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

    active_budget = _active_budget_for_project(
        project=estimate.project,
        actor_user_ids=actor_user_ids,
        select_related=["source_estimate"],
    )
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
