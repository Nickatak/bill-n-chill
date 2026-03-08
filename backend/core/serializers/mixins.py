"""Shared helpers for serializer method fields.

These functions extract the duplicated public-decision display logic that
appears in EstimateStatusEventSerializer and InvoiceStatusEventSerializer.
Each serializer provides a ``customer_fn`` callable that navigates from the
event object to the associated Customer.
"""

from __future__ import annotations

from typing import Any, Callable, Optional


def _is_public_decision(obj: Any) -> bool:
    """Return True if the event represents a customer action via a public link.

    Checks two signals:
    * ``"via public link"`` substring in ``obj.note`` (all event models).
    * ``metadata_json.public_decision is True`` (legacy signal, harmless
      extra attribute access for models that lack it).
    """
    note = getattr(obj, "note", "") or ""
    if "via public link" in note.lower():
        return True
    metadata = getattr(obj, "metadata_json", None) or {}
    if isinstance(metadata, dict) and metadata.get("public_decision") is True:
        return True
    return False


def resolve_public_actor_display(
    obj: Any,
    *,
    actor_field: str,
    customer_fn: Callable[[Any], Any],
) -> str:
    """Resolve a human-readable display name for the actor on an event.

    For public-decision events the customer's ``display_name`` is preferred.
    Falls back to the actor's email, then ``User #<id>``, then
    ``"Unknown user"``.
    """
    if _is_public_decision(obj):
        customer = customer_fn(obj)
        if customer and (customer.display_name or "").strip():
            return customer.display_name.strip()

    actor = getattr(obj, actor_field, None)
    actor_email = (getattr(actor, "email", "") or "").strip()
    if actor_email:
        return actor_email

    actor_id = getattr(obj, f"{actor_field}_id", None)
    if actor_id:
        return f"User #{actor_id}"

    return "Unknown user"


def resolve_public_actor_customer_id(
    obj: Any,
    *,
    customer_fn: Callable[[Any], Any],
) -> Optional[int]:
    """Return the customer PK when the event is a public decision, else None."""
    if not _is_public_decision(obj):
        return None
    customer = customer_fn(obj)
    return customer.id if customer else None
