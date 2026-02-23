import re

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Customer, CustomerRecord, LeadContact, LeadContactRecord, Project
from core.serializers import (
    CustomerSerializer,
    LeadContactManageSerializer,
    LeadContactQuickAddSerializer,
    LeadConvertSerializer,
    ProjectSerializer,
)


def _normalized_phone(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _find_duplicate_leads(user, *, phone: str, email: str):
    leads = LeadContact.objects.filter(created_by=user)
    phone_norm = _normalized_phone(phone)
    email_norm = (email or "").strip().lower()

    query = Q()
    if phone:
        query |= Q(phone=phone)
    if email_norm:
        query |= Q(email__iexact=email_norm)
    direct = list(leads.filter(query)) if query else []

    # Secondary pass for normalized phone matching (for example 5550100 vs 555-0100).
    phone_matches = []
    if phone_norm:
        for lead in leads:
            if _normalized_phone(lead.phone) == phone_norm:
                phone_matches.append(lead)

    deduped = {lead.id: lead for lead in [*direct, *phone_matches]}
    return list(deduped.values())


def _build_lead_contact_snapshot(lead: LeadContact) -> dict:
    return {
        "lead_contact": {
            "id": lead.id,
            "full_name": lead.full_name,
            "phone": lead.phone,
            "project_address": lead.project_address,
            "email": lead.email,
            "initial_contract_value": (
                str(lead.initial_contract_value) if lead.initial_contract_value is not None else None
            ),
            "notes": lead.notes,
            "status": lead.status,
            "source": lead.source,
            "converted_customer_id": lead.converted_customer_id,
            "converted_project_id": lead.converted_project_id,
            "converted_at": lead.converted_at.isoformat() if lead.converted_at else None,
            "created_by_id": lead.created_by_id,
            "created_at": lead.created_at.isoformat() if lead.created_at else None,
            "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
        }
    }


def _build_customer_snapshot(customer: Customer) -> dict:
    return {
        "customer": {
            "id": customer.id,
            "display_name": customer.display_name,
            "email": customer.email,
            "phone": customer.phone,
            "billing_address": customer.billing_address,
            "created_by_id": customer.created_by_id,
            "created_at": customer.created_at.isoformat() if customer.created_at else None,
            "updated_at": customer.updated_at.isoformat() if customer.updated_at else None,
        }
    }


def _record_lead_contact_record(
    *,
    lead: LeadContact,
    event_type: str,
    capture_source: str,
    recorded_by,
    from_status: str | None = None,
    to_status: str | None = None,
    source_reference: str = "",
    note: str = "",
    metadata: dict | None = None,
):
    LeadContactRecord.objects.create(
        lead_contact=lead,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        from_status=from_status,
        to_status=to_status,
        note=note,
        snapshot_json=_build_lead_contact_snapshot(lead),
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
def contacts_list_view(request):
    rows = LeadContact.objects.filter(created_by=request.user).order_by("-created_at")
    query = (request.query_params.get("q") or "").strip()
    if query:
        rows = rows.filter(
            Q(full_name__icontains=query)
            | Q(phone__icontains=query)
            | Q(email__icontains=query)
            | Q(project_address__icontains=query)
        )
    return Response({"data": LeadContactManageSerializer(rows, many=True).data})


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def contact_detail_view(request, contact_id: int):
    try:
        contact = LeadContact.objects.get(id=contact_id, created_by=request.user)
    except LeadContact.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Contact not found.",
                    "fields": {},
                }
            },
            status=404,
        )

    if request.method == "GET":
        return Response({"data": LeadContactManageSerializer(contact).data})

    if request.method == "DELETE":
        _record_lead_contact_record(
            lead=contact,
            event_type=LeadContactRecord.EventType.DELETED,
            capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=contact.status,
            to_status=None,
            note="Lead contact deleted.",
        )
        contact.delete()
        return Response(status=204)

    previous_status = contact.status
    serializer = LeadContactManageSerializer(contact, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    if contact.status != previous_status:
        _record_lead_contact_record(
            lead=contact,
            event_type=LeadContactRecord.EventType.STATUS_CHANGED,
            capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=previous_status,
            to_status=contact.status,
            note="Lead contact status changed.",
        )
    else:
        _record_lead_contact_record(
            lead=contact,
            event_type=LeadContactRecord.EventType.UPDATED,
            capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=previous_status,
            to_status=contact.status,
            note="Lead contact updated.",
        )
    return Response({"data": LeadContactManageSerializer(contact).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def quick_add_lead_contact_view(request):
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
        "source": request.data.get("source", LeadContact.Source.FIELD_MANUAL),
    }
    duplicate_resolution = request.data.get("duplicate_resolution")
    duplicate_target_id = request.data.get("duplicate_target_id")

    serializer = LeadContactQuickAddSerializer(
        data=raw_payload,
        context={"request": request},
    )
    serializer.is_valid(raise_exception=True)
    payload = serializer.validated_data

    duplicates = _find_duplicate_leads(
        request.user,
        phone=payload.get("phone", ""),
        email=payload.get("email", ""),
    )
    duplicate_ids = {lead.id for lead in duplicates}

    if duplicates and duplicate_resolution not in {
        "use_existing",
        "merge_existing",
        "create_anyway",
    }:
        candidates = LeadContactQuickAddSerializer(duplicates, many=True).data
        return Response(
            {
                "error": {
                    "code": "duplicate_detected",
                    "message": "Possible duplicate lead contacts found.",
                    "fields": {},
                },
                "data": {
                    "duplicate_candidates": candidates,
                    "allowed_resolutions": [
                        "use_existing",
                        "merge_existing",
                        "create_anyway",
                    ],
                },
            },
            status=409,
        )

    if duplicates and duplicate_resolution in {"use_existing", "merge_existing"}:
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

        target = next(lead for lead in duplicates if lead.id == target_id)

        if duplicate_resolution == "merge_existing":
            previous_status = target.status
            if payload["full_name"]:
                target.full_name = payload["full_name"]
            if payload["phone"]:
                target.phone = payload["phone"]
            if payload["project_address"]:
                target.project_address = payload["project_address"]
            if payload["email"]:
                target.email = payload["email"]
            if payload.get("initial_contract_value") is not None:
                target.initial_contract_value = payload["initial_contract_value"]
            target.source = payload["source"] or target.source
            if payload["notes"]:
                if target.notes:
                    target.notes = f"{target.notes}\n{payload['notes']}"
                else:
                    target.notes = payload["notes"]
            target.save()
            if target.status != previous_status:
                _record_lead_contact_record(
                    lead=target,
                    event_type=LeadContactRecord.EventType.STATUS_CHANGED,
                    capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    from_status=previous_status,
                    to_status=target.status,
                    note="Lead contact merged with duplicate payload (status changed).",
                )
            else:
                _record_lead_contact_record(
                    lead=target,
                    event_type=LeadContactRecord.EventType.UPDATED,
                    capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
                    recorded_by=request.user,
                    from_status=previous_status,
                    to_status=target.status,
                    note="Lead contact merged with duplicate payload.",
                )

        return Response(
            {
                "data": LeadContactQuickAddSerializer(target).data,
                "meta": {"duplicate_resolution": duplicate_resolution},
            },
            status=200,
        )

    lead = serializer.save()
    _record_lead_contact_record(
        lead=lead,
        event_type=LeadContactRecord.EventType.CREATED,
        capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
        recorded_by=request.user,
        from_status=None,
        to_status=lead.status,
        note="Lead contact created.",
    )

    return Response(
        {
            "data": LeadContactQuickAddSerializer(lead).data,
            "meta": {
                "duplicate_resolution": "create_anyway"
                if duplicate_resolution == "create_anyway"
                else "none"
            },
        },
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def convert_lead_to_project_view(request, lead_id: int):
    try:
        lead = LeadContact.objects.get(id=lead_id, created_by=request.user)
    except LeadContact.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Lead contact not found.",
                    "fields": {},
                }
            },
            status=404,
        )

    serializer = LeadConvertSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    if lead.converted_customer_id and lead.converted_project_id:
        return Response(
            {
                "data": {
                    "lead_contact": LeadContactQuickAddSerializer(lead).data,
                    "customer": CustomerSerializer(lead.converted_customer).data,
                    "project": ProjectSerializer(lead.converted_project).data,
                },
                "meta": {"conversion_status": "already_converted"},
            }
        )

    if not LeadContact.is_transition_allowed(lead.status, LeadContact.Status.PROJECT_CREATED):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": (
                        f"Invalid lead contact status transition: "
                        f"{lead.status} -> {LeadContact.Status.PROJECT_CREATED}."
                    ),
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    with transaction.atomic():
        customer = None
        email = (lead.email or "").strip().lower()
        if email:
            customer = (
                Customer.objects.filter(created_by=request.user, email__iexact=email)
                .order_by("-created_at")
                .first()
            )
        if not customer and lead.phone:
            customer = (
                Customer.objects.filter(created_by=request.user, phone=lead.phone)
                .order_by("-created_at")
                .first()
            )

        if not customer:
            customer = Customer.objects.create(
                display_name=lead.full_name,
                email=lead.email,
                phone=lead.phone,
                billing_address=lead.project_address,
                created_by=request.user,
            )
            _record_customer_record(
                customer=customer,
                event_type=CustomerRecord.EventType.CREATED,
                capture_source=CustomerRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                note="Customer created from lead conversion.",
            )
        elif not (customer.display_name or "").strip():
            customer.display_name = lead.full_name
            customer.save(update_fields=["display_name", "updated_at"])
            _record_customer_record(
                customer=customer,
                event_type=CustomerRecord.EventType.UPDATED,
                capture_source=CustomerRecord.CaptureSource.MANUAL_UI,
                recorded_by=request.user,
                note="Customer display name updated from lead conversion.",
            )

        project_name = data.get("project_name") or f"{lead.full_name} Project"
        project = Project.objects.create(
            customer=customer,
            name=project_name,
            site_address=lead.project_address,
            status=data.get("project_status", Project.Status.PROSPECT),
            contract_value_original=lead.initial_contract_value or 0,
            contract_value_current=lead.initial_contract_value or 0,
            created_by=request.user,
        )

        previous_status = lead.status
        lead.status = LeadContact.Status.PROJECT_CREATED
        lead.converted_customer = customer
        lead.converted_project = project
        lead.converted_at = timezone.now()
        lead.save(
            update_fields=[
                "status",
                "converted_customer",
                "converted_project",
                "converted_at",
                "updated_at",
            ]
        )
        _record_lead_contact_record(
            lead=lead,
            event_type=LeadContactRecord.EventType.CONVERTED,
            capture_source=LeadContactRecord.CaptureSource.MANUAL_UI,
            recorded_by=request.user,
            from_status=previous_status,
            to_status=lead.status,
            note="Lead converted to customer + project.",
            metadata={
                "converted_customer_id": customer.id,
                "converted_project_id": project.id,
            },
        )

    return Response(
        {
            "data": {
                "lead_contact": LeadContactQuickAddSerializer(lead).data,
                "customer": CustomerSerializer(customer).data,
                "project": ProjectSerializer(project).data,
            },
            "meta": {"conversion_status": "converted"},
        },
        status=201,
    )
