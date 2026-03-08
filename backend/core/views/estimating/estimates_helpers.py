"""Domain-specific helpers for estimate views."""

from decimal import Decimal

from core.models import (
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    Project,
)
from core.serializers import EstimateSerializer
from core.user_helpers import _ensure_membership
from core.utils.money import MONEY_ZERO, quantize_money
from core.views.helpers import _resolve_cost_codes_for_user


def _archive_estimate_family(*, project, user, title, exclude_ids, note):
    """Archive all same-title estimates in a family except the excluded IDs.

    Authorization: caller must have already validated that *project* belongs to the
    requesting user's organization.
    """
    normalized_title = (title or "").strip()
    if not normalized_title:
        return

    candidates = (
        Estimate.objects.filter(
            project=project,
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


def _next_estimate_family_version(*, project, title):
    """Return the next version number for an estimate family identified by title.

    Authorization: caller must have already validated that *project* belongs to the
    requesting user's organization.
    """
    normalized_title = (title or "").strip()
    latest = (
        Estimate.objects.filter(
            project=project,
            title=normalized_title,
        )
        .order_by("-version")
        .first()
    )
    return (latest.version + 1) if latest else 1


def _serialize_estimate(*, estimate):
    """Serialize a single estimate."""
    return EstimateSerializer(estimate).data


def _serialize_estimates(*, estimates, project):
    """Serialize multiple estimates sharing the same project."""
    return EstimateSerializer(estimates, many=True).data


def _sync_project_contract_baseline_if_unset(*, estimate):
    """Set the project's original and current contract values from the estimate if both are zero."""
    project = estimate.project
    if project.contract_value_original != Decimal("0") or project.contract_value_current != Decimal("0"):
        return False
    project.contract_value_original = estimate.grand_total
    project.contract_value_current = estimate.grand_total
    project.save(update_fields=["contract_value_original", "contract_value_current", "updated_at"])
    return True


def _activate_project_from_estimate_approval(*, estimate, actor, note: str):
    """Transition a prospect or on-hold project to active when its estimate is approved."""
    project = estimate.project
    if project.status not in (Project.Status.PROSPECT, Project.Status.ON_HOLD):
        return False
    if not Project.is_transition_allowed(project.status, Project.Status.ACTIVE):
        return False

    previous_status = project.status
    project.status = Project.Status.ACTIVE
    project.save(update_fields=["status", "updated_at"])
    return True


def _calculate_line_totals(line_items_data):
    """Compute per-line totals with markup and return normalized items, subtotal, and markup total."""
    subtotal = MONEY_ZERO
    markup_total = MONEY_ZERO
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_cost = Decimal(str(item["unit_cost"]))
        markup_percent = Decimal(str(item.get("markup_percent", 0)))
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


def _apply_estimate_lines_and_totals(estimate, line_items_data, tax_percent, user):
    """Replace an estimate's line items and recompute all totals. Returns an error dict on failure."""
    normalized_items, subtotal, markup_total = _calculate_line_totals(line_items_data)
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_percent = Decimal(str(tax_percent))
    tax_total = quantize_money((subtotal + markup_total) * (tax_percent / Decimal("100")))
    grand_total = quantize_money(subtotal + markup_total + tax_total)

    estimate.line_items.all().delete()
    new_lines = []
    for item in normalized_items:
        description = (item.get("description") or "").strip()
        unit_value = (item.get("unit") or "ea").strip().lower() or "ea"

        new_lines.append(
            EstimateLineItem(
                estimate=estimate,
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
