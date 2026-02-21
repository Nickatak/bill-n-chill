from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import AccountingSyncEvent
from core.serializers import AccountingSyncEventSerializer, AccountingSyncEventWriteSerializer
from core.views.helpers import _role_gate_error_payload, _validate_project_for_user


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_accounting_sync_events_view(request, project_id: int):
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        rows = AccountingSyncEvent.objects.filter(project=project, created_by=request.user).order_by(
            "-created_at", "-id"
        )
        return Response({"data": AccountingSyncEventSerializer(rows, many=True).data})

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "bookkeeping"})
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

    return Response({"data": AccountingSyncEventSerializer(sync_event).data}, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def accounting_sync_event_retry_view(request, sync_event_id: int):
    try:
        sync_event = AccountingSyncEvent.objects.get(
            id=sync_event_id,
            created_by=request.user,
        )
    except AccountingSyncEvent.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Accounting sync event not found.", "fields": {}}},
            status=404,
        )

    permission_error, _ = _role_gate_error_payload(request.user, {"owner", "bookkeeping"})
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
    return Response(
        {
            "data": AccountingSyncEventSerializer(sync_event).data,
            "meta": {"retry_status": "retried"},
        }
    )
