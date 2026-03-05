"""RBAC enforcement.

Capability gate for endpoint protection. Role constants and user-centric
resolution logic (role, capabilities, membership bootstrap) live in
user_helpers.py — this module is the enforcement layer that consumes them.
"""

from core.user_helpers import (  # noqa: F401 — re-exported for consumers
    RBAC_ROLE_BOOKKEEPING,
    RBAC_ROLE_OWNER,
    RBAC_ROLE_PM,
    RBAC_ROLE_VIEWER,
    RBAC_ROLE_WORKER,
    _resolve_user_capabilities,
)


def _capability_gate(user, resource: str, action: str):
    """Check if user has the required capability; returns (error_payload|None, capabilities).

    On success (user has the capability): returns (None, capabilities_dict).
    On deny (user lacks the capability): returns (error_dict, capabilities_dict).

    The caller gets the resolved capabilities dict in both cases so it can
    make further permission decisions without re-resolving.
    """
    capabilities = _resolve_user_capabilities(user)
    if action in capabilities.get(resource, []):
        return None, capabilities
    return (
        {
            "error": {
                "code": "forbidden",
                "message": "You do not have permission to perform this action.",
                "fields": {
                    "capability": [f"Required: {resource}.{action}."]
                },
            }
        },
        capabilities,
    )
