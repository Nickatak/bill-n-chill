"""Domain-specific helpers for estimate views."""

from decimal import Decimal

from django.conf import settings
from django.db import transaction
from rest_framework.response import Response

from core.models import (
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    Project,
)
from core.serializers import EstimateSerializer
from core.user_helpers import _ensure_membership
from core.utils.email import send_document_sent_email
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
    """Serialize multiple estimates."""
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


# ---------------------------------------------------------------------------
# PATCH concern handlers — called by the thin dispatcher in estimates.py
# ---------------------------------------------------------------------------


def _handle_estimate_document_save(request, estimate, data):
    """Apply field updates, line items, and totals to an estimate (the 'save' concern).

    Handles title, valid_through, tax_percent, and line items with totals
    recomputation.  Does not modify status or record audit events.
    """
    if "line_items" in data and not data["line_items"]:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one line item is required.",
                    "fields": {"line_items": ["At least one line item is required."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        update_fields = ["updated_at"]
        if "title" in data:
            estimate.title = data["title"]
            update_fields.append("title")
        if "valid_through" in data:
            estimate.valid_through = data["valid_through"]
            update_fields.append("valid_through")
        if "tax_percent" in data:
            estimate.tax_percent = data["tax_percent"]
            update_fields.append("tax_percent")
        if len(update_fields) > 1:
            estimate.save(update_fields=update_fields)

        if "line_items" in data:
            apply_error = _apply_estimate_lines_and_totals(
                estimate=estimate,
                line_items_data=data["line_items"],
                tax_percent=data.get("tax_percent", estimate.tax_percent),
                user=request.user,
            )
            if apply_error:
                transaction.set_rollback(True)
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "One or more cost codes are invalid for this user.",
                            "fields": {"cost_code": apply_error["missing_cost_codes"]},
                        }
                    },
                    status=400,
                )
        elif "tax_percent" in data:
            existing_lines = [
                {
                    "cost_code": line.cost_code_id,
                    "description": line.description,
                    "quantity": line.quantity,
                    "unit": line.unit,
                    "unit_cost": line.unit_cost,
                    "markup_percent": line.markup_percent,
                }
                for line in estimate.line_items.all()
            ]
            _apply_estimate_lines_and_totals(
                estimate=estimate,
                line_items_data=existing_lines,
                tax_percent=estimate.tax_percent,
                user=request.user,
            )

    estimate.refresh_from_db()
    return Response({"data": _serialize_estimate(estimate=estimate), "email_sent": False})


def _handle_estimate_status_transition(
    request, estimate, data, previous_status, next_status, is_resend,
):
    """Handle an estimate status transition: validate, apply, freeze org identity, audit, email.

    Called when the PATCH includes a real status change (previous != next) or a resend
    (sent -> sent).  Handles org identity freeze on draft departure, audit event
    recording, project activation on approval, and email notification on send.
    """
    status_note = (data.get("status_note", "") or "").strip()

    if not is_resend and not Estimate.is_transition_allowed(
        current_status=previous_status,
        next_status=next_status,
    ):
        if previous_status == Estimate.Status.DRAFT and next_status in {
            Estimate.Status.APPROVED,
            Estimate.Status.REJECTED,
        }:
            message = "Estimate must be sent before it can be approved or rejected."
        else:
            message = f"Invalid estimate status transition: {previous_status} -> {next_status}."
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": message,
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        update_fields = ["status", "updated_at"]
        estimate.status = next_status

        # Freeze org identity onto the document when leaving draft so public
        # pages never fall back to live (potentially changed) org defaults.
        if previous_status == Estimate.Status.DRAFT and next_status != Estimate.Status.DRAFT:
            membership = _ensure_membership(request.user)
            organization = membership.organization
            if not (estimate.terms_text or "").strip():
                org_terms = (organization.estimate_terms_and_conditions or "").strip()
                if org_terms:
                    estimate.terms_text = org_terms
                    update_fields.append("terms_text")
            if not (estimate.sender_name or "").strip():
                org_name = (organization.display_name or "").strip()
                if org_name:
                    estimate.sender_name = org_name
                    update_fields.append("sender_name")
            if not (estimate.sender_address or "").strip():
                org_address = organization.formatted_billing_address
                if org_address:
                    estimate.sender_address = org_address
                    update_fields.append("sender_address")
            if not (estimate.sender_logo_url or "").strip():
                if organization.logo:
                    estimate.sender_logo_url = request.build_absolute_uri(organization.logo.url)
                    update_fields.append("sender_logo_url")

        estimate.save(update_fields=update_fields)

        # Audit event
        event_note = status_note or ("Estimate re-sent." if is_resend else "Estimate status updated.")
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=previous_status,
            to_status=next_status,
            note=event_note,
            changed_by=request.user,
        )

        if next_status == Estimate.Status.APPROVED:
            _activate_project_from_estimate_approval(
                estimate=estimate,
                actor=request.user,
                note=f"Project moved to active after approval of estimate #{estimate.id}.",
            )

    # Email notification (outside transaction)
    email_sent = False
    if next_status == Estimate.Status.SENT and (
        previous_status != Estimate.Status.SENT or is_resend
    ):
        customer_email = (estimate.project.customer.email or "").strip()
        email_sent = send_document_sent_email(
            document_type="Estimate",
            document_title=f"{estimate.title} (v{estimate.version})",
            public_url=f"{settings.FRONTEND_URL}/estimate/{estimate.public_ref}",
            recipient_email=customer_email,
            sender_user=request.user,
        )

    estimate.refresh_from_db()
    return Response({"data": _serialize_estimate(estimate=estimate), "email_sent": email_sent})


def _handle_estimate_status_note(request, estimate, data):
    """Append an audit note to the estimate timeline without changing status.

    Called when the PATCH includes a status_note but no actual status change.
    """
    note_text = (data.get("status_note", "") or "").strip()

    with transaction.atomic():
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status=estimate.status,
            to_status=estimate.status,
            note=note_text,
            changed_by=request.user,
        )

    estimate.refresh_from_db()
    return Response({"data": _serialize_estimate(estimate=estimate), "email_sent": False})
