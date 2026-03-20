"""Domain-specific helpers for customer intake views."""

from datetime import datetime
from typing import Any

from django.contrib.auth.models import AbstractUser
from django.db.models import Q
from django.utils import timezone

from core.models import Customer, Project
from core.views.helpers import _ensure_org_membership, _normalized_phone


# ---------------------------------------------------------------------------
# Constants (imported by views)
# ---------------------------------------------------------------------------

ALLOWED_PROJECT_CREATE_STATUSES = {
    Project.Status.PROSPECT,
    Project.Status.ACTIVE,
}


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------


def _find_duplicate_customers(
    user: AbstractUser,
    *,
    phone: str,
    email: str,
) -> list[Customer]:
    """Find existing customers matching by phone or email for duplicate detection.

    Performs a two-pass search within the user's org:
        1. Direct DB filter on exact phone and case-insensitive email.
        2. Normalized phone comparison (digits-only) to catch formatting
           differences like ``555-0100`` vs ``5550100``.

    Returns a deduplicated list of matching customers.
    """
    membership = _ensure_org_membership(user)
    customers = Customer.objects.filter(organization_id=membership.organization_id)
    phone_norm = _normalized_phone(phone)
    email_norm = (email or "").strip().lower()

    query = Q()
    if phone:
        query |= Q(phone=phone)
    if email_norm:
        query |= Q(email__iexact=email_norm)
    direct = list(customers.filter(query)) if query else []

    # Secondary pass for normalized phone matching (for example 5550100 vs 555-0100).
    phone_matches = []
    if phone_norm:
        for customer in customers:
            if _normalized_phone(customer.phone) == phone_norm:
                phone_matches.append(customer)

    deduped = {customer.id: customer for customer in [*direct, *phone_matches]}
    return list(deduped.values())


def _build_customer_duplicate_candidate(customer: Customer) -> dict[str, Any]:
    """Serialize a customer into a lightweight duplicate-candidate dict.

    Used by the quick-add intake flow to present duplicate matches to the
    frontend so the user can choose ``use_existing`` or cancel.
    """
    return {
        "id": customer.id,
        "display_name": customer.display_name,
        "phone": customer.phone,
        "billing_address": customer.billing_address,
        "email": customer.email,
        "is_archived": customer.is_archived,
        "created_at": customer.created_at.isoformat() if customer.created_at else None,
    }


# ---------------------------------------------------------------------------
# Intake payload builders
# ---------------------------------------------------------------------------


def _build_intake_payload(
    *,
    payload: dict[str, Any],
    intake_record_id: int | None,
    created_at: datetime | None,
    converted_customer_id: int | None = None,
    converted_project_id: int | None = None,
    converted_at: datetime | None = None,
) -> dict[str, Any]:
    """Build the ``customer_intake`` sub-dict for a ``LeadContactRecord`` snapshot.

    Assembles the intake fields, conversion state, and timestamps into the
    shape expected by the frontend intake display and the audit snapshot.
    """
    return {
        "id": intake_record_id,
        "full_name": payload.get("full_name", ""),
        "phone": payload.get("phone", ""),
        "project_address": payload.get("project_address", ""),
        "email": payload.get("email", ""),
        "initial_contract_value": (
            str(payload.get("initial_contract_value"))
            if payload.get("initial_contract_value") is not None
            else None
        ),
        "notes": payload.get("notes", ""),
        "source": payload.get("source", ""),
        "is_archived": False,
        "has_project": converted_project_id is not None,
        "converted_customer": converted_customer_id,
        "converted_project": converted_project_id,
        "converted_at": converted_at.isoformat() if converted_at else None,
        "created_at": created_at.isoformat() if created_at else None,
    }


def build_intake_snapshot(
    *,
    payload: dict[str, Any],
    intake_record_id: int | None = None,
    converted_customer_id: int | None = None,
    converted_project_id: int | None = None,
    converted_at: datetime | None = None,
) -> dict[str, Any]:
    """Build the ``snapshot_json`` dict for a ``LeadContactRecord``.

    Wraps ``_build_intake_payload`` with a ``customer_intake`` key and
    auto-sets ``created_at`` to now.  Used by both the initial intake
    creation and the conversion record.
    """
    return {
        "customer_intake": _build_intake_payload(
            payload=payload,
            intake_record_id=intake_record_id,
            created_at=timezone.now(),
            converted_customer_id=converted_customer_id,
            converted_project_id=converted_project_id,
            converted_at=converted_at,
        )
    }
