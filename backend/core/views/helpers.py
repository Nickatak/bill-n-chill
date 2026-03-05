import re

from core.models import (
    Organization,
    OrganizationMembership,
    Project,
)
from core.rbac import _capability_gate  # noqa: F401 — re-exported for view modules
from core.user_helpers import _ensure_membership  # noqa: F401 — re-exported for view modules
from core.user_helpers import _organization_user_ids  # noqa: F401 — re-exported for view modules

SYSTEM_BUDGET_LINE_SPECS = [
    {
        "cost_code": "99-901",
        "cost_code_name": "Project Tools & Consumables",
        "description": "System: Project tools and consumables (non-client-billable)",
    },
    {
        "cost_code": "99-902",
        "cost_code_name": "Project Overhead",
        "description": "System: Project overhead and indirect spend (non-client-billable)",
    },
    {
        "cost_code": "99-903",
        "cost_code_name": "Unplanned Project Spend",
        "description": "System: Unplanned project spend bucket (non-client-billable)",
    },
]
SYSTEM_BUDGET_LINE_CODES = {row["cost_code"] for row in SYSTEM_BUDGET_LINE_SPECS}


def _validate_project_for_user(project_id: int, user):
    actor_user_ids = _organization_user_ids(user)
    try:
        return Project.objects.select_related("customer").get(
            id=project_id,
            created_by_id__in=actor_user_ids,
        )
    except Project.DoesNotExist:
        return None


def _resolve_organization_for_public_actor(actor_user):
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


def _serialize_public_organization_context(organization: Organization | None) -> dict:
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

    return {
        "display_name": (organization.display_name or "").strip(),
        "logo_url": (organization.logo_url or "").strip(),
        "billing_address": (organization.billing_address or "").strip(),
        "help_email": (organization.help_email or "").strip(),
        "invoice_terms_and_conditions": (organization.invoice_terms_and_conditions or "").strip(),
        "estimate_terms_and_conditions": (organization.estimate_terms_and_conditions or "").strip(),
        "change_order_terms_and_conditions": (organization.change_order_terms_and_conditions or "").strip(),
    }


def _serialize_public_project_context(project: Project) -> dict:
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


def _parse_request_bool(raw_value, *, default: bool = True) -> bool:
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
