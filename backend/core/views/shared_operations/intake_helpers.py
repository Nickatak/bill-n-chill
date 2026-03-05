"""Domain-specific helpers for customer intake views."""

from django.db.models import Q
from django.utils import timezone

from core.models import Customer
from core.views.helpers import _normalized_phone, _organization_user_ids


def _find_duplicate_customers(user, *, phone: str, email: str):
    """Find existing customers matching by phone or email for duplicate detection."""
    actor_user_ids = _organization_user_ids(user)
    customers = Customer.objects.filter(created_by_id__in=actor_user_ids)
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


def _build_customer_duplicate_candidate(customer: Customer) -> dict:
    """Serialize a customer into a lightweight duplicate-candidate dict."""
    return {
        "id": customer.id,
        "display_name": customer.display_name,
        "phone": customer.phone,
        "billing_address": customer.billing_address,
        "email": customer.email,
        "is_archived": customer.is_archived,
        "created_at": customer.created_at.isoformat() if customer.created_at else None,
    }


def _build_intake_payload(
    *,
    payload: dict,
    intake_record_id: int | None,
    created_at,
    converted_customer_id: int | None = None,
    converted_project_id: int | None = None,
    converted_at=None,
) -> dict:
    """Build the customer_intake sub-dict for a LeadContactRecord snapshot."""
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
    payload: dict,
    intake_record_id: int | None = None,
    converted_customer_id: int | None = None,
    converted_project_id: int | None = None,
    converted_at=None,
) -> dict:
    """Build the snapshot_json dict for a LeadContactRecord."""
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
