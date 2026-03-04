"""Shared customer-intake endpoints."""

import re
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Customer, CustomerRecord, LeadContactRecord, Project
from core.serializers import (
    CustomerIntakeQuickAddSerializer,
    CustomerProjectCreateSerializer,
    CustomerManageSerializer,
    CustomerSerializer,
    ProjectSerializer,
)
from core.views.helpers import _capability_gate, _organization_user_ids

ALLOWED_PROJECT_CREATE_STATUSES = {
    Project.Status.PROSPECT,
    Project.Status.ACTIVE,
}


def _normalized_phone(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _find_duplicate_customers(user, *, phone: str, email: str):
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
    return {
        "id": customer.id,
        "display_name": customer.display_name,
        "phone": customer.phone,
        "billing_address": customer.billing_address,
        "email": customer.email,
        "is_archived": customer.is_archived,
        "created_at": customer.created_at.isoformat() if customer.created_at else None,
    }


def _build_customer_snapshot(customer: Customer) -> dict:
    return {
        "customer": {
            "id": customer.id,
            "display_name": customer.display_name,
            "email": customer.email,
            "phone": customer.phone,
            "billing_address": customer.billing_address,
            "is_archived": customer.is_archived,
            "created_by_id": customer.created_by_id,
            "created_at": customer.created_at.isoformat() if customer.created_at else None,
            "updated_at": customer.updated_at.isoformat() if customer.updated_at else None,
        }
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


def _record_customer_intake_record(
    *,
    payload: dict,
    event_type: str,
    capture_source: str,
    recorded_by,
    source_reference: str = "",
    note: str = "",
    metadata: dict | None = None,
    intake_record_id: int | None = None,
    converted_customer_id: int | None = None,
    converted_project_id: int | None = None,
    converted_at=None,
):
    snapshot_json = {
        "customer_intake": _build_intake_payload(
            payload=payload,
            intake_record_id=intake_record_id,
            created_at=timezone.now(),
            converted_customer_id=converted_customer_id,
            converted_project_id=converted_project_id,
            converted_at=converted_at,
        )
    }
    return LeadContactRecord.objects.create(
        intake_record_id=intake_record_id,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        note=note,
        snapshot_json=snapshot_json,
        metadata_json=metadata or {},
        recorded_by=recorded_by,
    )

def _record_customer_record(
    *,
    customer: Customer,
    event_type: str,
    capture_source: str,
    recorded_by,
    source_reference: str = "",
    note: str = "",
    metadata: dict | None = None,
):
    CustomerRecord.objects.create(
        customer=customer,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        note=note,
        snapshot_json=_build_customer_snapshot(customer),
        metadata_json=metadata or {},
        recorded_by=recorded_by,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def customers_list_view(request):
    """List organization-scoped customers with optional free-text filtering."""
    actor_user_ids = _organization_user_ids(request.user)
    rows = (
        Customer.objects.filter(created_by_id__in=actor_user_ids)
        .annotate(
            project_count=Count(
                "projects",
                filter=~Q(projects__status=Project.Status.PROSPECT),
                distinct=True,
            ),
            active_project_count=Count(
                "projects",
                filter=Q(projects__status__in=[Project.Status.ACTIVE, Project.Status.ON_HOLD]),
                distinct=True,
            ),
        )
        .order_by("-created_at")
    )
    query = (request.query_params.get("q") or "").strip()
    if query:
        rows = rows.filter(
            Q(display_name__icontains=query)
            | Q(phone__icontains=query)
            | Q(email__icontains=query)
            | Q(billing_address__icontains=query)
        )
    data = CustomerManageSerializer(rows, many=True).data
    for row in data:
        row["has_project"] = row["project_count"] > 0
        row["has_active_or_on_hold_project"] = row["active_project_count"] > 0
    return Response({"data": data})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def customer_detail_view(request, customer_id: int):
    """Fetch or update a customer with immutable record capture on writes.

    Contract:
    - `PATCH`: appends `CustomerRecord(updated)` in-transaction.
      - When `is_archived` changes `false -> true`, all `prospect` projects for that customer
        are transitioned to `cancelled` in the same transaction.
    - `DELETE`: intentionally unsupported (`405`); archive via `PATCH is_archived`.
    """
    actor_user_ids = _organization_user_ids(request.user)
    contact = (
        Customer.objects.filter(id=customer_id, created_by_id__in=actor_user_ids)
        .annotate(
            project_count=Count(
                "projects",
                filter=~Q(projects__status=Project.Status.PROSPECT),
                distinct=True,
            ),
            active_project_count=Count(
                "projects",
                filter=Q(projects__status__in=[Project.Status.ACTIVE, Project.Status.ON_HOLD]),
                distinct=True,
            ),
        )
        .first()
    )
    if contact is None:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Customer not found.",
                    "fields": {},
                }
            },
            status=404,
        )

    if request.method == "GET":
        payload = CustomerManageSerializer(contact).data
        payload["has_project"] = payload["project_count"] > 0
        payload["has_active_or_on_hold_project"] = payload["active_project_count"] > 0
        return Response({"data": payload})

    permission_error, _ = _capability_gate(request.user, "customers", "edit")
    if permission_error:
        return Response(permission_error, status=403)

    with transaction.atomic():
        previous_is_archived = contact.is_archived
        serializer = CustomerManageSerializer(contact, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            serializer.save()
        except DjangoValidationError as exc:
            if hasattr(exc, "message_dict"):
                return Response(exc.message_dict, status=400)
            return Response({"non_field_errors": exc.messages}, status=400)

        cancelled_prospect_project_count = 0
        if not previous_is_archived and contact.is_archived:
            cancelled_prospect_project_count = contact.projects.filter(
                status=Project.Status.PROSPECT
            ).update(status=Project.Status.CANCELLED, updated_at=timezone.now())

        _record_customer_record(
            customer=contact,
            event_type=CustomerRecord.EventType.UPDATED,
            capture_source=CustomerRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            note=(
                "Customer archive state changed."
                if contact.is_archived != previous_is_archived
                else "Customer updated."
            ),
            metadata={
                "from_is_archived": previous_is_archived,
                "to_is_archived": contact.is_archived,
                "cancelled_prospect_project_count": cancelled_prospect_project_count,
            }
            if contact.is_archived != previous_is_archived
            else {},
        )

    refreshed = (
        Customer.objects.filter(id=contact.id, created_by_id__in=actor_user_ids)
        .annotate(
            project_count=Count(
                "projects",
                filter=~Q(projects__status=Project.Status.PROSPECT),
                distinct=True,
            ),
            active_project_count=Count(
                "projects",
                filter=Q(projects__status__in=[Project.Status.ACTIVE, Project.Status.ON_HOLD]),
                distinct=True,
            ),
        )
        .first()
    )
    payload = CustomerManageSerializer(refreshed).data
    payload["has_project"] = payload["project_count"] > 0
    payload["has_active_or_on_hold_project"] = payload["active_project_count"] > 0
    return Response({"data": payload})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def customer_project_create_view(request, customer_id: int):
    """Create a new project directly from a customer context.

    Contract:
    - Customer must be visible to the caller's organization scope.
    - Defaults:
      - `name`: `<customer display name> Project`
      - `site_address`: customer billing address
      - `status`: `prospect`
      - `initial_contract_value`: `0`
    """
    actor_user_ids = _organization_user_ids(request.user)
    customer = Customer.objects.filter(id=customer_id, created_by_id__in=actor_user_ids).first()
    if customer is None:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Customer not found.",
                    "fields": {},
                }
            },
            status=404,
        )

    permission_error, _ = _capability_gate(request.user, "projects", "create")
    if permission_error:
        return Response(permission_error, status=403)

    serializer = CustomerProjectCreateSerializer(data=request.data or {})
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    project_name = (payload.get("name") or "").strip() or f"{customer.display_name} Project"
    site_address = (payload.get("site_address") or "").strip() or customer.billing_address
    if not site_address:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Site address is required.",
                    "fields": {"site_address": ["Site address is required."]},
                }
            },
            status=400,
        )
    requested_status = payload.get("status", Project.Status.PROSPECT)
    initial_contract_value = payload.get("initial_contract_value")
    if initial_contract_value is None:
        initial_contract_value = Decimal("0")

    try:
        with transaction.atomic():
            project = Project.objects.create(
                customer=customer,
                name=project_name,
                site_address=site_address,
                status=Project.Status.PROSPECT,
                contract_value_original=initial_contract_value,
                contract_value_current=initial_contract_value,
                created_by=request.user,
            )
            status_transition = "created_as_prospect"
            if requested_status == Project.Status.ACTIVE:
                project.status = Project.Status.ACTIVE
                project.save()
                status_transition = "prospect_to_active"
            _record_customer_record(
                customer=customer,
                event_type=CustomerRecord.EventType.UPDATED,
                capture_source=CustomerRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                note="Project created from customer workspace.",
                metadata={
                    "project_id": project.id,
                    "project_status_requested": requested_status,
                    "project_status_created_as": Project.Status.PROSPECT,
                    "project_status_final": project.status,
                    "project_status_transition": status_transition,
                },
            )
    except DjangoValidationError as exc:
        if hasattr(exc, "message_dict"):
            fields = exc.message_dict
        else:
            fields = {"non_field_errors": exc.messages}
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Project creation failed validation.",
                    "fields": fields,
                }
            },
            status=400,
        )

    return Response(
        {
            "data": {
                "project": ProjectSerializer(project).data,
                "customer": CustomerSerializer(customer).data,
            }
        },
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def quick_add_customer_intake_view(request):
    """Create customer-first intake rows with immutable provenance and optional project creation.

    Contract:
    - Supports duplicate resolutions: `use_existing|create_anyway`.
    - Duplicate detection and persistence are customer-first.
    - Intake provenance is captured as immutable `LeadContactRecord`.
    - Optional project creation is performed in the same request when `create_project=true`.
    """
    permission_error, _ = _capability_gate(request.user, "customers", "create")
    if permission_error:
        return Response(permission_error, status=403)

    initial_contract_value = request.data.get("initial_contract_value", None)
    if initial_contract_value == "":
        initial_contract_value = None

    raw_payload = {
        "full_name": request.data.get("full_name", ""),
        "phone": request.data.get("phone", ""),
        "project_address": request.data.get("project_address", ""),
        "email": request.data.get("email", ""),
        "initial_contract_value": initial_contract_value,
        "notes": request.data.get("notes", ""),
        "source": request.data.get("source", "field_manual"),
    }
    duplicate_resolution = request.data.get("duplicate_resolution")
    duplicate_target_id = request.data.get("duplicate_target_id")
    create_project_raw = request.data.get("create_project", False)
    project_name = str(request.data.get("project_name") or "").strip()
    project_status = str(request.data.get("project_status") or Project.Status.PROSPECT).strip()
    create_project = str(create_project_raw).strip().lower() in {"true", "1", "yes", "on"}

    serializer = CustomerIntakeQuickAddSerializer(
        data=raw_payload,
    )
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    project_address = (payload.get("project_address") or "").strip()

    if create_project and not project_address:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Project address is required when creating a project.",
                    "fields": {
                        "project_address": [
                            "Project address is required when creating a project."
                        ]
                    },
                }
            },
            status=400,
        )

    if create_project and not project_name:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Project name is required when creating a project.",
                    "fields": {
                        "project_name": [
                            "Project name is required when creating a project."
                        ]
                    },
                }
            },
            status=400,
        )

    if create_project and project_status not in ALLOWED_PROJECT_CREATE_STATUSES:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Invalid project creation status.",
                    "fields": {
                        "project_status": [
                            "Project creation only allows: prospect or active."
                        ]
                    },
                }
            },
            status=400,
        )

    duplicates = _find_duplicate_customers(
        request.user,
        phone=payload.get("phone", ""),
        email=payload.get("email", ""),
    )
    duplicate_ids = {customer.id for customer in duplicates}

    if duplicates and duplicate_resolution != "use_existing":
        candidates = [_build_customer_duplicate_candidate(customer) for customer in duplicates]
        return Response(
            {
                "error": {
                    "code": "duplicate_detected",
                    "message": "A customer with this phone or email already exists.",
                    "fields": {},
                },
                "data": {
                    "duplicate_candidates": candidates,
                    "allowed_resolutions": [
                        "use_existing",
                    ],
                },
            },
            status=409,
        )

    selected_customer = None
    if duplicates and duplicate_resolution == "use_existing":
        try:
            target_id = int(duplicate_target_id)
        except (TypeError, ValueError):
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "duplicate_target_id is required for selected resolution.",
                        "fields": {"duplicate_target_id": ["This field is required."]},
                    }
                },
                status=400,
            )

        if target_id not in duplicate_ids:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "duplicate_target_id must reference a detected duplicate.",
                        "fields": {
                            "duplicate_target_id": [
                                "Selected record was not found in duplicate candidates."
                            ]
                        },
                    }
                },
                status=400,
            )

        selected_customer = next(customer for customer in duplicates if customer.id == target_id)

    customer = None
    customer_created = False
    project = None
    converted_at = None
    intake_record_id = None
    intake_record_created_at = None

    try:
        with transaction.atomic():
            if selected_customer is not None:
                customer = selected_customer
            else:
                customer = Customer.objects.create(
                    display_name=payload["full_name"],
                    phone=payload["phone"],
                    email=payload["email"],
                    billing_address=payload["project_address"],
                    created_by=request.user,
                )
                customer_created = True
                _record_customer_record(
                    customer=customer,
                    event_type=CustomerRecord.EventType.CREATED,
                    capture_source=CustomerRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    note="Customer created from intake quick add.",
                )

            created_record = _record_customer_intake_record(
                payload=payload,
                event_type=LeadContactRecord.EventType.CREATED,
                capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                note="Customer intake captured.",
                metadata={
                    "customer_id": customer.id,
                    "duplicate_resolution": duplicate_resolution or "none",
                },
            )
            intake_record_id = created_record.id
            intake_record_created_at = created_record.created_at

            if create_project:
                resolved_project_name = project_name or f"{payload['full_name']} Project"
                requested_project_status = project_status
                project = Project.objects.create(
                    customer=customer,
                    name=resolved_project_name,
                    site_address=payload["project_address"],
                    status=Project.Status.PROSPECT,
                    contract_value_original=payload.get("initial_contract_value") or 0,
                    contract_value_current=payload.get("initial_contract_value") or 0,
                    created_by=request.user,
                )
                status_transition = "created_as_prospect"
                if requested_project_status == Project.Status.ACTIVE:
                    project.status = Project.Status.ACTIVE
                    project.save()
                    status_transition = "prospect_to_active"
                converted_at = timezone.now()
                _record_customer_intake_record(
                    payload=payload,
                    event_type=LeadContactRecord.EventType.CONVERTED,
                    capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    note="Customer intake converted during quick add.",
                    metadata={
                        "converted_customer_id": customer.id,
                        "converted_project_id": project.id,
                        "project_status_requested": requested_project_status,
                        "project_status_created_as": Project.Status.PROSPECT,
                        "project_status_final": project.status,
                        "project_status_transition": status_transition,
                    },
                    intake_record_id=intake_record_id,
                    converted_customer_id=customer.id,
                    converted_project_id=project.id,
                    converted_at=converted_at,
                )
    except DjangoValidationError as exc:
        if hasattr(exc, "message_dict"):
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Quick add failed validation.",
                        "fields": exc.message_dict,
                    }
                },
                status=400,
            )
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Quick add failed validation.",
                    "fields": {"non_field_errors": exc.messages},
                }
            },
            status=400,
        )

    intake_payload = _build_intake_payload(
        payload=payload,
        intake_record_id=intake_record_id,
        created_at=intake_record_created_at or timezone.now(),
        converted_customer_id=customer.id if project else None,
        converted_project_id=project.id if project else None,
        converted_at=converted_at,
    )

    return Response(
        {
            "data": {
                "customer_intake": intake_payload,
                "customer": CustomerSerializer(customer).data,
                "project": ProjectSerializer(project).data if project else None,
            },
            "meta": {
                "duplicate_resolution": duplicate_resolution or "none",
                "conversion_status": "converted" if project else "not_requested",
                "customer_created": customer_created,
            },
        },
        status=201,
    )
