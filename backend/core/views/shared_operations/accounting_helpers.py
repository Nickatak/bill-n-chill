"""Domain-specific helpers for accounting sync views."""

from typing import Any

from django.contrib.auth.models import AbstractUser

from core.models import AccountingSyncEvent, AccountingSyncRecord


def _build_accounting_sync_snapshot(sync_event: AccountingSyncEvent) -> dict[str, Any]:
    """Serialize an accounting sync event into an immutable snapshot dict.

    Captures the full state of a sync event at a point in time for inclusion
    in ``AccountingSyncRecord.snapshot_json``.  Used by ``_record_accounting_sync_record``
    on every create/retry/status-change audit write.
    """
    return {
        "accounting_sync_event": {
            "id": sync_event.id,
            "project_id": sync_event.project_id,
            "provider": sync_event.provider,
            "object_type": sync_event.object_type,
            "object_id": sync_event.object_id,
            "direction": sync_event.direction,
            "status": sync_event.status,
            "external_id": sync_event.external_id,
            "error_message": sync_event.error_message,
            "retry_count": sync_event.retry_count,
            "last_attempt_at": (
                sync_event.last_attempt_at.isoformat() if sync_event.last_attempt_at else None
            ),
        }
    }


def _record_accounting_sync_record(
    *,
    sync_event: AccountingSyncEvent,
    event_type: str,
    capture_source: str,
    recorded_by: AbstractUser,
    from_status: str | None = None,
    to_status: str | None = None,
    source_reference: str = "",
    note: str = "",
    metadata: dict[str, Any] | None = None,
) -> AccountingSyncRecord:
    """Create an immutable ``AccountingSyncRecord`` with a point-in-time snapshot.

    Wraps the standard audit-record creation pattern: builds the snapshot via
    ``_build_accounting_sync_snapshot``, then writes the record with the provided
    event metadata.  Returns the created record.
    """
    return AccountingSyncRecord.objects.create(
        accounting_sync_event=sync_event,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        from_status=from_status,
        to_status=to_status,
        note=note,
        snapshot_json=_build_accounting_sync_snapshot(sync_event),
        metadata_json=metadata or {},
        recorded_by=recorded_by,
    )
