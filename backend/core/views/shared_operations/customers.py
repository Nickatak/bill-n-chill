"""Shared customer-intake endpoints."""

import logging

from decimal import Decimal

logger = logging.getLogger(__name__)

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
from core.views.helpers import _capability_gate, _ensure_org_membership, _paginate_queryset, _parse_request_bool
from core.views.shared_operations.customers_helpers import (
    ALLOWED_PROJECT_CREATE_STATUSES,
    _build_customer_duplicate_candidate,
    _build_intake_payload,
    _find_duplicate_customers,
    build_intake_snapshot,
)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def customers_list_view(request):
    """List organization-scoped customers with optional free-text search and pagination.

    Annotates each customer with ``projects_count`` (non-prospect) and
    ``active_projects_count`` for frontend display.  Supports ``?q=`` search
    across display name, phone, email, and billing address.

    Flow:
        1. Scope to user's org with project count annotations.
        2. Apply optional ``?q=`` filter.
        3. Paginate and return.

    URL: ``GET /api/v1/customers/?q=...&page=1&page_size=25``

    Request body: (none)

    Success 200::

        { "data": [{ ... }], "meta": { "page": 1, "total_count": 42, ... } }
    """
    membership = _ensure_org_membership(request.user)
    customers = (
        Customer.objects.filter(organization_id=membership.organization_id)
        .annotate(
            projects_count=Count(
                "projects",
                filter=~Q(projects__status=Project.Status.PROSPECT),
                distinct=True,
            ),
            active_projects_count=Count(
                "projects",
                filter=Q(projects__status__in=[Project.Status.ACTIVE, Project.Status.ON_HOLD]),
                distinct=True,
            ),
        )
        .order_by("-created_at")
    )
    query = (request.query_params.get("q") or "").strip()
    if query:
        customers = customers.filter(
            Q(display_name__icontains=query)
            | Q(phone__icontains=query)
            | Q(email__icontains=query)
            | Q(billing_address__icontains=query)
        )

    customers, pagination = _paginate_queryset(customers, request.query_params)

    data = CustomerManageSerializer(customers, many=True).data
    for customer_data in data:
        customer_data["has_project"] = customer_data["projects_count"] > 0
        customer_data["has_active_or_on_hold_project"] = customer_data["active_projects_count"] > 0
    return Response({"data": data, "pagination_metadata": pagination})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def customer_detail_view(request, customer_id):
    """Fetch or update a customer with immutable record capture on writes.

    PATCH appends a ``CustomerRecord(updated)`` in-transaction.  When
    ``is_archived`` transitions from false to true, all prospect-status
    projects for that customer are auto-cancelled in the same transaction.
    Active/on-hold projects block archival entirely (enforced by
    ``Customer.clean()``).

    Flow (GET):
        1. Look up customer scoped to user's org with project annotations.
        2. Return serialized customer with computed flags.

    Flow (PATCH):
        1. Capability gate: ``customers.edit``.
        2. Partial update via serializer (with ``Customer.clean()`` safety net).
        3. If archiving, cancel any prospect projects.
        4. Append ``CustomerRecord`` audit row.
        5. Re-fetch with fresh annotations and return.

    URL: ``GET/PATCH /api/v1/customers/<customer_id>/``

    Request body (PATCH)::

        { "display_name": "...", "is_archived": true }

    Success 200::

        { "data": { ... } }

    Errors:
        - 400: Validation error (e.g., archiving customer with active projects).
        - 403: Missing ``customers.edit`` capability.
        - 404: Customer not found.
    """
    membership = _ensure_org_membership(request.user)
    customer = (
        Customer.objects.filter(id=customer_id, organization_id=membership.organization_id)
        .annotate(
            projects_count=Count(
                "projects",
                filter=~Q(projects__status=Project.Status.PROSPECT),
                distinct=True,
            ),
            active_projects_count=Count(
                "projects",
                filter=Q(projects__status__in=[Project.Status.ACTIVE, Project.Status.ON_HOLD]),
                distinct=True,
            ),
        )
        .first()
    )
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

    if request.method == "GET":
        payload = CustomerManageSerializer(customer).data
        payload["has_project"] = payload["projects_count"] > 0
        payload["has_active_or_on_hold_project"] = payload["active_projects_count"] > 0
        return Response({"data": payload})

    elif request.method == "PATCH":
        permission_error, _ = _capability_gate(request.user, "customers", "edit")
        if permission_error:
            return Response(permission_error, status=403)

        with transaction.atomic():
            previous_is_archived = customer.is_archived
            serializer = CustomerManageSerializer(customer, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            # save() → full_clean() → Customer.clean(), which raises
            # DjangoValidationError if archiving a customer with active/on-hold
            # projects.  Frontend disables the toggle in that case, but this is
            # the backend safety net.
            try:
                serializer.save()
            except DjangoValidationError as exc:
                if hasattr(exc, "message_dict"):
                    return Response(exc.message_dict, status=400)
                return Response({"non_field_errors": exc.messages}, status=400)

            # Archive cascade: when a customer is archived, auto-cancel any
            # prospect-status projects.  Active/on-hold projects block archival
            # entirely (enforced by Customer.clean() above).
            cancelled_prospect_projects_count = 0
            if not previous_is_archived and customer.is_archived:
                cancelled_prospect_projects_count = customer.projects.filter(
                    status=Project.Status.PROSPECT
                ).update(status=Project.Status.CANCELLED, updated_at=timezone.now())

            CustomerRecord.record(
                customer=customer,
                event_type=CustomerRecord.EventType.UPDATED,
                capture_source=CustomerRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                note=(
                    "Customer archive state changed."
                    if customer.is_archived != previous_is_archived
                    else "Customer updated."
                ),
                metadata={
                    "from_is_archived": previous_is_archived,
                    "to_is_archived": customer.is_archived,
                    "cancelled_prospect_project_count": cancelled_prospect_projects_count,
                }
                if customer.is_archived != previous_is_archived
                else {},
            )

        # Re-fetch with fresh annotations — projects_count / active_projects_count
        # are DB-computed and may have changed after the prospect cancellation.
        annotated_customer = (
            Customer.objects.filter(id=customer.id, organization_id=membership.organization_id)
            .annotate(
                projects_count=Count(
                    "projects",
                    filter=~Q(projects__status=Project.Status.PROSPECT),
                    distinct=True,
                ),
                active_projects_count=Count(
                    "projects",
                    filter=Q(projects__status__in=[Project.Status.ACTIVE, Project.Status.ON_HOLD]),
                    distinct=True,
                ),
            )
            .first()
        )
        payload = CustomerManageSerializer(annotated_customer).data
        payload["has_project"] = payload["projects_count"] > 0
        payload["has_active_or_on_hold_project"] = payload["active_projects_count"] > 0
        return Response({"data": payload})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def customer_project_create_view(request, customer_id):
    """Create a new project directly from a customer context.

    Defaults project name to ``<customer name> Project``, site address to
    the customer's billing address, status to prospect, and contract value
    to zero.  Optionally accepts ``status: active`` to skip the prospect stage.

    Flow:
        1. Look up customer scoped to user's org.
        2. Capability gate: ``projects.create``.
        3. Validate and apply defaults.
        4. Create project + ``CustomerRecord`` audit row (atomic).
        5. If requested status is active, transition immediately.

    URL: ``POST /api/v1/customers/<customer_id>/projects/``

    Request body::

        { "name": "Kitchen Remodel", "site_address": "...", "status": "prospect" }

    Success 201::

        { "data": { "project": { ... }, "customer": { ... } } }

    Errors:
        - 400: Validation error (missing site address, invalid status).
        - 403: Missing ``projects.create`` capability.
        - 404: Customer not found.
    """
    membership = _ensure_org_membership(request.user)
    customer = Customer.objects.filter(id=customer_id, organization_id=membership.organization_id).first()
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
                organization_id=membership.organization_id,
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
            CustomerRecord.record(
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
    """Create a customer via quick-add intake with duplicate detection and optional project.

    Supports duplicate resolution: when duplicates are detected, returns a 409
    with candidates.  The frontend can re-submit with ``duplicate_resolution:
    use_existing`` and a ``duplicate_target_id`` to link to an existing customer.
    Intake provenance is captured as an immutable ``LeadContactRecord``.
    Optional project creation happens in the same transaction.

    Flow:
        1. Capability gate: ``customers.create``.
        2. Validate intake fields via serializer.
        3. If ``create_project``, validate project fields (address, name, status).
        4. Run duplicate detection on phone/email.
        5. If duplicates found and no resolution provided, return 409 with candidates.
        6. If ``use_existing``, validate ``duplicate_target_id``.
        7. Create or select customer + ``LeadContactRecord`` + optional project (atomic).
        8. Return intake payload with customer, project, and resolution metadata.

    URL: ``POST /api/v1/customers/quick-add/``

    Request body::

        {
            "full_name": "Jane Doe", "phone": "555-1234", "email": "jane@example.com",
            "project_address": "123 Main St", "create_project": true,
            "project_name": "Kitchen Remodel", "project_status": "prospect"
        }

    Success 201::

        { "data": { "customer_intake": {...}, "customer": {...}, "project": {...} }, "meta": {...} }

    Errors:
        - 400: Validation error (missing fields, invalid status, bad duplicate_target_id).
        - 403: Missing ``customers.create`` capability.
        - 409: Duplicate detected — includes candidates and allowed resolutions.
    """
    permission_error, _ = _capability_gate(request.user, "customers", "create")
    if permission_error:
        return Response(permission_error, status=403)

    membership = _ensure_org_membership(request.user)
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
    create_project = _parse_request_bool(create_project_raw, default=False)

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
                    organization_id=membership.organization_id,
                    display_name=payload["full_name"],
                    phone=payload["phone"],
                    email=payload["email"],
                    billing_address=payload["project_address"],
                    created_by=request.user,
                )
                customer_created = True
                CustomerRecord.record(
                    customer=customer,
                    event_type=CustomerRecord.EventType.CREATED,
                    capture_source=CustomerRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    note="Customer created from intake quick add.",
                )
                logger.info("Customer created: id=%s name='%s' by %s", customer.id, customer.display_name, request.user.email)

            created_record = LeadContactRecord.record(
                snapshot_json=build_intake_snapshot(payload=payload),
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
                    organization_id=membership.organization_id,
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
                LeadContactRecord.record(
                    snapshot_json=build_intake_snapshot(
                        payload=payload,
                        intake_record_id=intake_record_id,
                        converted_customer_id=customer.id,
                        converted_project_id=project.id,
                        converted_at=converted_at,
                    ),
                    event_type=LeadContactRecord.EventType.CONVERTED,
                    capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    intake_record_id=intake_record_id,
                    note="Customer intake converted during quick add.",
                    metadata={
                        "converted_customer_id": customer.id,
                        "converted_project_id": project.id,
                        "project_status_requested": requested_project_status,
                        "project_status_created_as": Project.Status.PROSPECT,
                        "project_status_final": project.status,
                        "project_status_transition": status_transition,
                    },
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
