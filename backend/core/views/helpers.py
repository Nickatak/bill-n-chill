"""Cross-domain shared helpers and re-exports for the view layer.

This module is the single import point for utilities used across multiple
domain view files.  It re-exports RBAC and membership helpers so domain
views can import from one place, and provides shared validation, pagination,
serialization, and query-building functions.
"""

import re
from typing import Any

from django.contrib.auth.models import AbstractUser
from django.db.models import Q, QuerySet
from rest_framework.response import Response

from core.models import (
    CostCode,
    Quote,
    Organization,
    OrganizationMembership,
    Project,
)
from core.rbac import _capability_gate  # noqa: F401 — re-exported for view modules
from core.user_helpers import _ensure_org_membership  # noqa: F401 — re-exported for view modules


# ---------------------------------------------------------------------------
# Entity validation (org-scoped lookups)
# ---------------------------------------------------------------------------


def _validate_project_for_user(project_id: int, user: AbstractUser) -> Project | None:
    """Look up a project by ID, scoped to the user's organization.

    Uses ``select_related("customer")`` so the caller can access customer
    fields without an extra query.  Returns ``None`` if the project doesn't
    exist or doesn't belong to the user's org.
    """
    membership = _ensure_org_membership(user)
    try:
        return Project.objects.select_related("customer").get(
            id=project_id,
            organization_id=membership.organization_id,
        )
    except Project.DoesNotExist:
        return None


def _validate_quote_for_user(
    quote_id: int,
    user: AbstractUser,
    *,
    prefetch_lines: bool = False,
) -> Quote | None:
    """Look up an quote by ID, authorized via its project's org scope.

    The quote is accessible if its project belongs to the requesting user's
    organization.  Optionally prefetches line items and their cost codes for
    views that need the full quote detail (clone, duplicate, detail).

    Returns ``None`` if not found or not authorized.
    """
    membership = _ensure_org_membership(user)
    quote_qs = Quote.objects.select_related("project", "project__customer").filter(
        id=quote_id,
        project__organization_id=membership.organization_id,
    )
    if prefetch_lines:
        quote_qs = quote_qs.prefetch_related("line_items", "line_items__cost_code")
    return quote_qs.first()


# ---------------------------------------------------------------------------
# Project auto-promotion
# ---------------------------------------------------------------------------


def _promote_prospect_to_active(project: Project) -> bool:
    """Silently promote a prospect project to active.

    Called when a financial commitment is made: sending an quote or
    invoice, creating a vendor bill, or creating a receipt.  Any of these
    actions imply the project is no longer speculative.

    Returns ``True`` if the project was promoted, ``False`` if it was
    already past prospect status.
    """
    if project.status != Project.Status.PROSPECT:
        return False
    project.status = Project.Status.ACTIVE
    project.save(update_fields=["status", "updated_at"])
    return True


# ---------------------------------------------------------------------------
# Public-facing context serialization
# ---------------------------------------------------------------------------


def _resolve_organization_for_public_actor(actor_user: AbstractUser) -> Organization | None:
    """Resolve the primary organization for a public-facing actor user.

    Used by public detail/decision views to look up branding context (logo,
    name, terms) from the document creator's org.  Falls back to ownership
    lookup if no active membership exists (shouldn't happen in practice).
    """
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


def _serialize_public_organization_context(
    organization: Organization | None,
    request: Any = None,
) -> dict[str, str]:
    """Serialize organization branding fields for public-facing document contexts.

    Returns display name, logo URL, billing address, help email, and per-document-type
    terms and conditions.  If ``request`` is provided, the logo URL is built as an
    absolute URI; otherwise falls back to the relative path.
    """
    if not organization:
        return {
            "display_name": "",
            "logo_url": "",
            "billing_address": "",
            "help_email": "",
            "invoice_terms_and_conditions": "",
            "quote_terms_and_conditions": "",
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
        "quote_terms_and_conditions": (organization.quote_terms_and_conditions or "").strip(),
        "change_order_terms_and_conditions": (organization.change_order_terms_and_conditions or "").strip(),
    }


def _serialize_public_project_context(project: Project) -> dict[str, Any]:
    """Serialize project and customer fields for public-facing document contexts.

    Provides the minimal project + customer info needed by public quote,
    change order, and invoice preview pages (name, status, customer contact).
    """
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


# ---------------------------------------------------------------------------
# Pagination and request parsing
# ---------------------------------------------------------------------------


def _paginate_queryset(
    queryset: QuerySet,
    query_params: dict[str, Any],
    *,
    default_page_size: int = 25,
    max_page_size: int = 100,
) -> tuple[QuerySet, dict[str, int]]:
    """Apply page/page_size pagination to a queryset.

    Reads ``page`` and ``page_size`` from ``query_params``, clamping to valid
    ranges.  Returns ``(sliced_queryset, meta_dict)`` where ``meta_dict``
    contains ``page``, ``page_size``, ``total_count``, and ``total_pages``.
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


def _parse_request_bool(raw_value: Any, *, default: bool = True) -> bool:
    """Coerce a loosely-typed request value to a boolean.

    Handles strings (``"true"``/``"false"``/``"1"``/``"0"``/``"yes"``/``"no"``),
    ints, bools, and ``None``.  Returns ``default`` for empty or unrecognized values.
    """
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
    """Strip a phone string to digits only (for duplicate-detection comparisons).

    Used by customer intake to detect duplicate phone numbers regardless of
    formatting differences (dashes, spaces, parens, etc.).
    """
    return re.sub(r"\D", "", value or "")


# ---------------------------------------------------------------------------
# Shared cross-domain helpers
# ---------------------------------------------------------------------------


def _build_public_decision_note(
    *,
    action_label: str,
    note: str,
    decider_name: str,
    decider_email: str,
) -> str:
    """Build a human-readable note for a public-link decision (approve/reject/dispute).

    Combines the action, actor identity, and optional customer note into a single
    string stored on status events and audit records.  Falls back to "anonymous
    customer" if neither name nor email is available.
    """
    actor_parts = [part for part in [decider_name.strip(), decider_email.strip()] if part]
    actor_label = " / ".join(actor_parts) if actor_parts else "anonymous customer"
    note_value = note.strip()
    if note_value:
        return f"{action_label} via public link by {actor_label}. {note_value}"
    return f"{action_label} via public link by {actor_label}."


def _org_scope_filter(user: AbstractUser) -> Q:
    """Build a Q filter scoped to the given user's organization.

    Used for entity queries (cost codes, vendors, etc.) that need to be
    restricted to the user's org without a full model lookup.
    """
    membership = _ensure_org_membership(user)
    return Q(organization_id=membership.organization_id)


def _resolve_cost_codes_for_user(
    user: AbstractUser,
    line_items_data: list[dict[str, Any]],
    *,
    cost_code_key: str = "cost_code",
) -> tuple[dict[int, CostCode], list[int]]:
    """Resolve and validate cost code IDs from line item data for the user's org scope.

    Extracts cost code IDs from ``line_items_data`` using ``cost_code_key``,
    fetches the matching ``CostCode`` records scoped to the user's org, and
    identifies any IDs that don't exist or aren't in scope.

    Returns ``(cost_code_map, missing_ids)`` where ``cost_code_map`` is
    ``{id: CostCode}`` and ``missing_ids`` lists IDs that couldn't be resolved.
    Items where the key is absent or falsy are silently skipped.
    """
    cost_code_ids = [item[cost_code_key] for item in line_items_data if item.get(cost_code_key)]
    if not cost_code_ids:
        return {}, []

    membership = _ensure_org_membership(user)
    cost_codes = CostCode.objects.filter(
        id__in=cost_code_ids,
        organization_id=membership.organization_id,
    )
    cost_code_map = {code.id: code for code in cost_codes}
    missing_ids = [cid for cid in cost_code_ids if cid not in cost_code_map]
    return cost_code_map, missing_ids


def _check_project_accepts_document(
    project: Project,
    document_type: str,
) -> Response | None:
    """Guard against creating new documents on terminal-status projects.

    Rules:
    - **Cancelled** projects block all new documents (quotes, change orders,
      invoices, vendor bills).  Payments are NOT routed through this guard.
    - **Completed** projects block quotes and change orders but allow
      invoices and vendor bills (final retainage / late sub bills are common).

    Returns an error ``Response`` if the project status forbids creation,
    or ``None`` if the creation is allowed.
    """
    status = project.status

    if status == Project.Status.CANCELLED:
        return Response(
            {
                "error": {
                    "code": "project_terminal",
                    "message": f"Cannot create {document_type} on a cancelled project.",
                    "fields": {},
                }
            },
            status=400,
        )

    if status == Project.Status.COMPLETED and document_type in ("quotes", "change orders"):
        return Response(
            {
                "error": {
                    "code": "project_terminal",
                    "message": f"Cannot create {document_type} on a completed project.",
                    "fields": {},
                }
            },
            status=400,
        )

    return None


def _not_found_response(message: str = "Not found.") -> Response:
    """Return a standard 404 error response.

    Convenience wrapper so views don't repeat the error envelope structure
    for simple not-found cases.
    """
    return Response(
        {"error": {"code": "not_found", "message": message, "fields": {}}},
        status=404,
    )
