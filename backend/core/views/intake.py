import re

from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from core.models import Customer, LeadContact, Project
from core.serializers import (
    CustomerSerializer,
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def quick_add_lead_contact_view(request):
    payload = {
        "full_name": request.data.get("full_name", ""),
        "phone": request.data.get("phone", ""),
        "project_address": request.data.get("project_address", ""),
        "email": request.data.get("email", ""),
        "notes": request.data.get("notes", ""),
        "source": request.data.get("source", LeadContact.Source.FIELD_MANUAL),
    }
    duplicate_resolution = request.data.get("duplicate_resolution")
    duplicate_target_id = request.data.get("duplicate_target_id")

    duplicates = _find_duplicate_leads(
        request.user,
        phone=payload["phone"],
        email=payload["email"],
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
            if payload["full_name"]:
                target.full_name = payload["full_name"]
            if payload["phone"]:
                target.phone = payload["phone"]
            if payload["project_address"]:
                target.project_address = payload["project_address"]
            if payload["email"]:
                target.email = payload["email"]
            target.source = payload["source"] or target.source
            if payload["notes"]:
                if target.notes:
                    target.notes = f"{target.notes}\n{payload['notes']}"
                else:
                    target.notes = payload["notes"]
            target.save()

        return Response(
            {
                "data": LeadContactQuickAddSerializer(target).data,
                "meta": {"duplicate_resolution": duplicate_resolution},
            },
            status=200,
        )

    serializer = LeadContactQuickAddSerializer(data=payload, context={"request": request})
    serializer.is_valid(raise_exception=True)
    lead = serializer.save()

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

    project_name = data.get("project_name") or f"{lead.full_name} Project"
    project = Project.objects.create(
        customer=customer,
        name=project_name,
        status=data.get("project_status", Project.Status.PROSPECT),
        created_by=request.user,
    )

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
