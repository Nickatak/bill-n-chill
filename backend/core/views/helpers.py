"""Cross-domain shared helpers and re-exports for the view layer."""

import re

from django.db.models import Q
from rest_framework.response import Response

from core.models import (
    CostCode,
    Estimate,
    Organization,
    OrganizationMembership,
    Project,
)
from core.rbac import _capability_gate  # noqa: F401 — re-exported for view modules
from core.user_helpers import _ensure_membership  # noqa: F401 — re-exported for view modules


def _validate_project_for_user(project_id: int, user):
    """Look up a project by ID, scoped to the user's organization. Returns None if not found."""
    membership = _ensure_membership(user)
    try:
        return Project.objects.select_related("customer").get(
            id=project_id,
            organization_id=membership.organization_id,
        )
    except Project.DoesNotExist:
        return None


def _validate_estimate_for_user(estimate_id: int, user, *, prefetch_lines=False):
    """Look up an estimate by ID, authorized via its project's org scope. Returns None if not found.

    The estimate is accessible if its project belongs to the requesting user's organization.
    """
    membership = _ensure_membership(user)
    qs = Estimate.objects.select_related("project", "project__customer").filter(
        id=estimate_id,
        project__organization_id=membership.organization_id,
    )
    if prefetch_lines:
        qs = qs.prefetch_related("line_items", "line_items__cost_code")
    return qs.first()


def _resolve_organization_for_public_actor(actor_user):
    """Resolve the primary organization for a public-facing actor user."""
    if not actor_user:
        return None
    membership = (
        OrganizationMembership.objects.select_related("organization")
        .filter(
            user=actor_user,
            status=OrganizationMembership.Status.ACTIVE,
        )
        .order_by("id")
        .first()
    )
    if membership and membership.organization_id:
        return membership.organization
    return Organization.objects.filter(created_by=actor_user).order_by("id").first()


def _serialize_public_organization_context(organization: Organization | None, request=None) -> dict:
    """Serialize organization branding fields for public-facing document contexts."""
    if not organization:
        return {
            "display_name": "",
            "logo_url": "",
            "billing_address": "",
            "help_email": "",
            "invoice_terms_and_conditions": "",
            "estimate_terms_and_conditions": "",
            "change_order_terms_and_conditions": "",
        }

    logo_url = ""
    if organization.logo:
        logo_url = request.build_absolute_uri(organization.logo.url) if request else organization.logo.url

    return {
        "display_name": (organization.display_name or "").strip(),
        "logo_url": logo_url,
        "billing_address": organization.formatted_billing_address,
        "help_email": (organization.help_email or "").strip(),
        "invoice_terms_and_conditions": (organization.invoice_terms_and_conditions or "").strip(),
        "estimate_terms_and_conditions": (organization.estimate_terms_and_conditions or "").strip(),
        "change_order_terms_and_conditions": (organization.change_order_terms_and_conditions or "").strip(),
    }


def _serialize_public_project_context(project: Project) -> dict:
    """Serialize project and customer fields for public-facing document contexts."""
    customer = project.customer
    return {
        "id": project.id,
        "name": project.name,
        "status": project.status,
        "customer_display_name": customer.display_name,
        "customer_billing_address": customer.billing_address,
        "customer_email": customer.email,
        "customer_phone": customer.phone,
    }


def _paginate_queryset(queryset, query_params, *, default_page_size: int = 25, max_page_size: int = 100):
    """Apply page/page_size pagination to a queryset.

    Returns ``(sliced_queryset, meta_dict)`` where *meta_dict* contains
    ``page``, ``page_size``, ``total_count``, and ``total_pages``.
    """
    total_count = queryset.count()
    try:
        page_size = max(1, min(max_page_size, int(query_params.get("page_size", default_page_size))))
    except (ValueError, TypeError):
        page_size = default_page_size
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    try:
        page = max(1, min(total_pages, int(query_params.get("page", 1))))
    except (ValueError, TypeError):
        page = 1
    offset = (page - 1) * page_size
    return queryset[offset : offset + page_size], {
        "page": page,
        "page_size": page_size,
        "total_count": total_count,
        "total_pages": total_pages,
    }


def _parse_request_bool(raw_value, *, default: bool = True) -> bool:
    """Coerce a loosely-typed request value to a boolean."""
    if raw_value is None:
        return default
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, int):
        return raw_value != 0

    normalized = str(raw_value).strip().lower()
    if not normalized:
        return default
    if normalized in {"true", "1", "yes", "y", "on"}:
        return True
    if normalized in {"false", "0", "no", "n", "off"}:
        return False
    return default


def _normalized_phone(value: str) -> str:
    """Strip a phone string to digits only (for duplicate-detection comparisons)."""
    return re.sub(r"\D", "", value or "")


# ---------------------------------------------------------------------------
# Shared cross-domain helpers (deduplicated from per-domain *_helpers.py)
# ---------------------------------------------------------------------------


def _build_public_decision_note(
    *,
    action_label: str,
    note: str,
    decider_name: str,
    decider_email: str,
) -> str:
    """Build a human-readable note for a public-link decision (approve/reject/dispute)."""
    actor_parts = [part for part in [decider_name.strip(), decider_email.strip()] if part]
    actor_label = " / ".join(actor_parts) if actor_parts else "anonymous customer"
    note_value = note.strip()
    if note_value:
        return f"{action_label} via public link by {actor_label}. {note_value}"
    return f"{action_label} via public link by {actor_label}."


def _cost_code_scope_filter(user) -> Q:
    """Build a Q filter for cost codes visible to the given user's organization."""
    membership = _ensure_membership(user)
    return Q(organization_id=membership.organization_id)


def _vendor_scope_filter(user) -> Q:
    """Build a Q filter for vendors visible to the given user's organization."""
    membership = _ensure_membership(user)
    return Q(organization_id=membership.organization_id)


def _resolve_cost_codes_for_user(user, line_items_data, *, cost_code_key="cost_code"):
    """Resolve and validate cost code IDs from line item data for the user's org scope.

    Returns ``(code_map, missing_ids)``.  *cost_code_key* defaults to ``"cost_code"``
    and items where the key is absent/falsy are silently skipped.
    """
    ids = [item[cost_code_key] for item in line_items_data if item.get(cost_code_key)]
    if not ids:
        return {}, []

    membership = _ensure_membership(user)
    codes = CostCode.objects.filter(
        id__in=ids,
        organization_id=membership.organization_id,
    )
    code_map = {code.id: code for code in codes}
    missing = [cost_code_id for cost_code_id in ids if cost_code_id not in code_map]
    return code_map, missing


def _not_found_response(message: str = "Not found."):
    """Return a standard 404 error response."""
    return Response(
        {"error": {"code": "not_found", "message": message, "fields": {}}},
        status=404,
    )
