"""Shared operational accounting sync endpoints."""

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import AccountingSyncEvent, AccountingSyncRecord
from core.serializers import AccountingSyncEventSerializer, AccountingSyncEventWriteSerializer
from core.views.helpers import _capability_gate, _ensure_org_membership, _validate_project_for_user
from core.views.shared_operations.accounting_helpers import _record_accounting_sync_record


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_accounting_sync_events_view(request, project_id):
    """List project accounting sync events or enqueue a new sync event.

    GET returns the full sync event history for a project, ordered most
    recent first.  POST creates a new sync event with an immutable audit
    record.  Events created with a terminal status (success/failed) get
    ``last_attempt_at`` set automatically.

    Flow (GET):
        1. Validate project belongs to user's org.
        2. Return serialized sync events.

    Flow (POST):
        1. Validate project belongs to user's org.
        2. Capability gate: ``accounting_sync.create``.
        3. Validate required fields (provider, object_type, direction).
        4. Create sync event + audit record (atomic).

    URL: ``GET/POST /api/v1/projects/<project_id>/accounting-sync-events/``

    Request body (POST)::

        { "provider": "quickbooks", "object_type": "invoice", "direction": "outbound", ... }

    Success 200 (GET)::

        { "data": [{ ... }, ...] }

    Success 201 (POST)::

        { "data": { ... } }

    Errors:
        - 400: Missing required fields.
        - 403: Missing ``accounting_sync.create`` capability.
        - 404: Project not found.
    """
    if not (project := _validate_project_for_user(project_id, request.user)):
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = AccountingSyncEvent.objects.filter(
            project=project,
        ).order_by("-created_at", "-id")
        return Response({"data": AccountingSyncEventSerializer(rows, many=True).data})

    elif request.method == "POST":
        permission_error, _ = _capability_gate(request.user, "accounting_sync", "create")
        if permission_error:
            return Response(permission_error, status=403)

        serializer = AccountingSyncEventWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        fields = {}
        if "provider" not in data:
            fields["provider"] = ["This field is required."]
        if "object_type" not in data:
            fields["object_type"] = ["This field is required."]
        if "direction" not in data:
            fields["direction"] = ["This field is required."]
        if fields:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Missing required fields for accounting sync event creation.",
                        "fields": fields,
                    }
                },
                status=400,
            )

        with transaction.atomic():
            sync_event = AccountingSyncEvent.objects.create(
                project=project,
                provider=data["provider"],
                object_type=data["object_type"],
                object_id=data.get("object_id"),
                direction=data["direction"],
                status=data.get("status", AccountingSyncEvent.Status.QUEUED),
                external_id=data.get("external_id", ""),
                error_message=data.get("error_message", ""),
                created_by=request.user,
            )
            if sync_event.status in {AccountingSyncEvent.Status.SUCCESS, AccountingSyncEvent.Status.FAILED}:
                sync_event.last_attempt_at = timezone.now()
                sync_event.save(update_fields=["last_attempt_at", "updated_at"])
            _record_accounting_sync_record(
                sync_event=sync_event,
                event_type=AccountingSyncRecord.EventType.CREATED,
                capture_source=AccountingSyncRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                from_status=None,
                to_status=sync_event.status,
                note="Accounting sync event created.",
                metadata={
                    "provider": sync_event.provider,
                    "object_type": sync_event.object_type,
                    "object_id": sync_event.object_id,
                    "direction": sync_event.direction,
                },
            )

        return Response({"data": AccountingSyncEventSerializer(sync_event).data}, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def accounting_sync_event_retry_view(request, sync_event_id):
    """Retry a failed accounting sync event by resetting it to ``queued``.

    Only failed events can be retried.  Successful events are rejected (400),
    and already-queued events return a no-op with ``retry_status: already_queued``.
    The retry is atomic: status fields are updated and an immutable audit record
    is appended.

    Flow:
        1. Look up sync event scoped to user's org.
        2. Capability gate: ``accounting_sync.retry``.
        3. If already queued, return no-op.
        4. If successful, reject (400).
        5. Reset status to queued, increment retry count (atomic) + audit record.

    URL: ``POST /api/v1/accounting-sync-events/<sync_event_id>/retry/``

    Request body: (none)

    Success 200::

        { "data": { ... }, "meta": { "retry_status": "retried" } }

    Errors:
        - 400: Event is in ``success`` status (not retryable).
        - 403: Missing ``accounting_sync.retry`` capability.
        - 404: Sync event not found.
    """
    membership = _ensure_org_membership(request.user)
    try:
        sync_event = AccountingSyncEvent.objects.get(
            id=sync_event_id,
            project__organization_id=membership.organization_id,
        )
    except AccountingSyncEvent.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Accounting sync event not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _capability_gate(request.user, "accounting_sync", "retry")
    if permission_error:
        return Response(permission_error, status=403)

    if sync_event.status == AccountingSyncEvent.Status.QUEUED:
        return Response(
            {
                "data": AccountingSyncEventSerializer(sync_event).data,
                "meta": {"retry_status": "already_queued"},
            }
        )

    if sync_event.status == AccountingSyncEvent.Status.SUCCESS:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Successful sync events cannot be retried.",
                    "fields": {"status": ["Retry is only allowed for failed events."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        previous_status = sync_event.status
        sync_event.status = AccountingSyncEvent.Status.QUEUED
        sync_event.error_message = ""
        sync_event.retry_count = sync_event.retry_count + 1
        sync_event.last_attempt_at = timezone.now()
        sync_event.save(
            update_fields=[
                "status",
                "error_message",
                "retry_count",
                "last_attempt_at",
                "updated_at",
            ]
        )
        _record_accounting_sync_record(
            sync_event=sync_event,
            event_type=AccountingSyncRecord.EventType.RETRIED,
            capture_source=AccountingSyncRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=previous_status,
            to_status=sync_event.status,
            note="Accounting sync event retried.",
            metadata={
                "retry_count": sync_event.retry_count,
                "direction": sync_event.direction,
                "object_type": sync_event.object_type,
                "object_id": sync_event.object_id,
            },
        )
    return Response(
        {
            "data": AccountingSyncEventSerializer(sync_event).data,
            "meta": {"retry_status": "retried"},
        }
    )
