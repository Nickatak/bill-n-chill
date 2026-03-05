"""Shared base builder for policy contract dicts.

Private module — imported by sibling policy files, not by external consumers.
"""

from __future__ import annotations

from typing import Any


def _build_base_policy_contract(
    *,
    model_class: type,
    policy_version: str,
    default_create_status: str,
    extra_transitions: dict[str, list[str]] | None = None,
    extra_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the standard policy contract dict shared across all workflow domains.

    Extracts status ordering, labels, allowed transitions, and terminal statuses
    from a Django model that exposes ``Status.choices`` and
    ``ALLOWED_STATUS_TRANSITIONS``.

    Args:
        model_class: Django model with ``.Status.choices`` and
            ``.ALLOWED_STATUS_TRANSITIONS``.
        policy_version: Semver-style version string for cache-busting.
        default_create_status: The status assigned to newly created records.
        extra_transitions: Optional mapping of ``{source_status: [target_statuses]}``
            to merge into the model's transition map (e.g. compound transitions).
        extra_fields: Optional dict of additional keys to include in the
            returned contract.

    Returns:
        Dict consumable by frontend policy consumers, containing at minimum
        ``policy_version``, ``statuses``, ``status_labels``,
        ``default_create_status``, ``allowed_status_transitions``, and
        ``terminal_statuses``, plus any *extra_fields*.
    """
    statuses = [status for status, _label in model_class.Status.choices]
    status_index = {status: idx for idx, status in enumerate(statuses)}
    status_labels = {status: label for status, label in model_class.Status.choices}

    allowed_status_transitions: dict[str, list[str]] = {}
    for status in statuses:
        next_statuses = list(
            model_class.ALLOWED_STATUS_TRANSITIONS.get(status, set())
        )
        if extra_transitions:
            for compound_target in extra_transitions.get(status, []):
                if compound_target not in next_statuses:
                    next_statuses.append(compound_target)
        next_statuses.sort(key=lambda value: status_index.get(value, 999))
        allowed_status_transitions[status] = next_statuses

    terminal_statuses = [
        status
        for status in statuses
        if not allowed_status_transitions.get(status, [])
    ]

    contract: dict[str, Any] = {
        "policy_version": policy_version,
        "status_labels": status_labels,
        "statuses": statuses,
        "default_create_status": default_create_status,
        "allowed_status_transitions": allowed_status_transitions,
        "terminal_statuses": terminal_statuses,
    }
    if extra_fields:
        contract.update(extra_fields)
    return contract
