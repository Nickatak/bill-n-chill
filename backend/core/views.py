import re
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from core.models import CostCode, Customer, Estimate, EstimateLineItem, EstimateStatusEvent, LeadContact, Project
from core.serializers import (
    CostCodeSerializer,
    CustomerSerializer,
    EstimateSerializer,
    EstimateStatusEventSerializer,
    EstimateWriteSerializer,
    LeadContactQuickAddSerializer,
    LeadConvertSerializer,
    LoginSerializer,
    ProjectProfileSerializer,
    ProjectSerializer,
)

ALLOWED_ESTIMATE_STATUS_TRANSITIONS = {
    Estimate.Status.DRAFT: {Estimate.Status.SENT, Estimate.Status.ARCHIVED},
    Estimate.Status.SENT: {
        Estimate.Status.DRAFT,
        Estimate.Status.APPROVED,
        Estimate.Status.REJECTED,
        Estimate.Status.ARCHIVED,
    },
    Estimate.Status.APPROVED: {Estimate.Status.ARCHIVED},
    Estimate.Status.REJECTED: {Estimate.Status.DRAFT, Estimate.Status.ARCHIVED},
    Estimate.Status.ARCHIVED: set(),
}


@api_view(["GET"])
@permission_classes([AllowAny])
def health_view(_request):
    return Response({"data": {"status": "ok"}})


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data["user"]
    token, _ = Token.objects.get_or_create(user=user)

    return Response(
        {
            "data": {
                "token": token.key,
                "user": {
                    "id": user.id,
                    "email": user.email,
                },
            }
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me_view(request):
    user = request.user
    return Response({"data": {"id": user.id, "email": user.email}})


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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def projects_list_view(request):
    projects = Project.objects.filter(created_by=request.user).select_related("customer")
    serializer = ProjectProfileSerializer(projects, many=True)
    return Response({"data": serializer.data})


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def project_detail_view(request, project_id: int):
    try:
        project = Project.objects.select_related("customer").get(
            id=project_id,
            created_by=request.user,
        )
    except Project.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Project not found.",
                    "fields": {},
                }
            },
            status=404,
        )

    if request.method == "GET":
        return Response({"data": ProjectProfileSerializer(project).data})

    serializer = ProjectProfileSerializer(project, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response({"data": serializer.data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def cost_codes_list_create_view(request):
    if request.method == "GET":
        codes = CostCode.objects.filter(created_by=request.user)
        serializer = CostCodeSerializer(codes, many=True)
        return Response({"data": serializer.data})

    serializer = CostCodeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    code = serializer.save(created_by=request.user)
    return Response({"data": CostCodeSerializer(code).data}, status=201)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def cost_code_detail_view(request, cost_code_id: int):
    try:
        code = CostCode.objects.get(id=cost_code_id, created_by=request.user)
    except CostCode.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Cost code not found.",
                    "fields": {},
                }
            },
            status=404,
        )

    serializer = CostCodeSerializer(code, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response({"data": serializer.data})


def _validate_project_for_user(project_id: int, user):
    try:
        return Project.objects.get(id=project_id, created_by=user)
    except Project.DoesNotExist:
        return None


def _calculate_line_totals(line_items_data):
    subtotal = Decimal("0")
    markup_total = Decimal("0")
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_cost = Decimal(str(item["unit_cost"]))
        markup_percent = Decimal(str(item.get("markup_percent", 0)))
        base = quantity * unit_cost
        markup = base * (markup_percent / Decimal("100"))
        line_total = base + markup
        subtotal += base
        markup_total += markup
        normalized_items.append(
            {
                **item,
                "quantity": quantity,
                "unit_cost": unit_cost,
                "markup_percent": markup_percent,
                "line_total": line_total,
            }
        )

    return normalized_items, subtotal, markup_total


def _resolve_cost_codes_for_user(user, line_items_data):
    ids = [item["cost_code"] for item in line_items_data]
    codes = CostCode.objects.filter(created_by=user, id__in=ids, is_active=True)
    code_map = {code.id: code for code in codes}
    missing = [cost_code_id for cost_code_id in ids if cost_code_id not in code_map]
    return code_map, missing


def _apply_estimate_lines_and_totals(estimate, line_items_data, tax_percent, user):
    normalized_items, subtotal, markup_total = _calculate_line_totals(line_items_data)
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}

    tax_percent = Decimal(str(tax_percent))
    tax_total = (subtotal + markup_total) * (tax_percent / Decimal("100"))
    grand_total = subtotal + markup_total + tax_total

    estimate.line_items.all().delete()
    new_lines = []
    for item in normalized_items:
        new_lines.append(
            EstimateLineItem(
                estimate=estimate,
                cost_code=code_map[item["cost_code"]],
                description=item["description"],
                quantity=item["quantity"],
                unit=item.get("unit", "ea"),
                unit_cost=item["unit_cost"],
                markup_percent=item["markup_percent"],
                line_total=item["line_total"],
            )
        )
    EstimateLineItem.objects.bulk_create(new_lines)

    estimate.subtotal = subtotal
    estimate.markup_total = markup_total
    estimate.tax_percent = tax_percent
    estimate.tax_total = tax_total
    estimate.grand_total = grand_total
    estimate.save(
        update_fields=[
            "subtotal",
            "markup_total",
            "tax_percent",
            "tax_total",
            "grand_total",
            "updated_at",
        ]
    )
    return None


def _record_estimate_status_event(*, estimate, from_status, to_status, note, changed_by):
    EstimateStatusEvent.objects.create(
        estimate=estimate,
        from_status=from_status,
        to_status=to_status,
        note=note,
        changed_by=changed_by,
    )


def _validate_estimate_status_transition(*, current_status, next_status):
    if current_status == next_status:
        return True
    allowed = ALLOWED_ESTIMATE_STATUS_TRANSITIONS.get(current_status, set())
    return next_status in allowed


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def project_estimates_view(request, project_id: int):
    project = _validate_project_for_user(project_id, request.user)
    if not project:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        estimates = (
            Estimate.objects.filter(project=project, created_by=request.user)
            .prefetch_related("line_items", "line_items__cost_code")
            .order_by("-version")
        )
        return Response({"data": EstimateSerializer(estimates, many=True).data})

    serializer = EstimateWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    line_items = data.get("line_items", [])
    if not line_items:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "At least one line item is required.",
                    "fields": {"line_items": ["At least one line item is required."]},
                }
            },
            status=400,
        )

    latest = (
        Estimate.objects.filter(project=project, created_by=request.user)
        .order_by("-version")
        .first()
    )
    next_version = (latest.version + 1) if latest else 1

    estimate = Estimate.objects.create(
        project=project,
        created_by=request.user,
        version=next_version,
        status=data.get("status", Estimate.Status.DRAFT),
        title=data.get("title", ""),
        tax_percent=data.get("tax_percent", Decimal("0")),
    )

    apply_error = _apply_estimate_lines_and_totals(
        estimate=estimate,
        line_items_data=line_items,
        tax_percent=data.get("tax_percent", Decimal("0")),
        user=request.user,
    )
    if apply_error:
        estimate.delete()
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "One or more cost codes are invalid for this user.",
                    "fields": {"cost_code": apply_error["missing_cost_codes"]},
                }
            },
            status=400,
        )

    estimate.refresh_from_db()
    _record_estimate_status_event(
        estimate=estimate,
        from_status=None,
        to_status=estimate.status,
        note="Estimate created.",
        changed_by=request.user,
    )
    return Response({"data": EstimateSerializer(estimate).data}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def estimate_detail_view(request, estimate_id: int):
    try:
        estimate = Estimate.objects.get(id=estimate_id, created_by=request.user)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    if request.method == "GET":
        return Response({"data": EstimateSerializer(estimate).data})

    serializer = EstimateWriteSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    status_note = data.get("status_note", "")
    status_changing = "status" in data
    next_status = data.get("status", estimate.status)

    if status_changing and not _validate_estimate_status_transition(
        current_status=estimate.status,
        next_status=next_status,
    ):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid estimate status transition: {estimate.status} -> {next_status}.",
                    "fields": {"status": ["This transition is not allowed."]},
                }
            },
            status=400,
        )

    previous_status = estimate.status
    update_fields = ["updated_at"]
    if "title" in data:
        estimate.title = data["title"]
        update_fields.append("title")
    if "status" in data:
        estimate.status = data["status"]
        update_fields.append("status")
    if "tax_percent" in data:
        estimate.tax_percent = data["tax_percent"]
        update_fields.append("tax_percent")
    estimate.save(update_fields=update_fields)

    if "line_items" in data:
        line_items = data["line_items"]
        if not line_items:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "At least one line item is required.",
                        "fields": {"line_items": ["At least one line item is required."]},
                    }
                },
                status=400,
            )
        apply_error = _apply_estimate_lines_and_totals(
            estimate=estimate,
            line_items_data=line_items,
            tax_percent=data.get("tax_percent", estimate.tax_percent),
            user=request.user,
        )
        if apply_error:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "One or more cost codes are invalid for this user.",
                        "fields": {"cost_code": apply_error["missing_cost_codes"]},
                    }
                },
                status=400,
            )
    elif "tax_percent" in data:
        # Recalculate totals with existing lines when tax is updated.
        existing_lines = [
            {
                "cost_code": line.cost_code_id,
                "description": line.description,
                "quantity": line.quantity,
                "unit": line.unit,
                "unit_cost": line.unit_cost,
                "markup_percent": line.markup_percent,
            }
            for line in estimate.line_items.all()
        ]
        _apply_estimate_lines_and_totals(
            estimate=estimate,
            line_items_data=existing_lines,
            tax_percent=estimate.tax_percent,
            user=request.user,
        )

    if status_changing and previous_status != estimate.status:
        _record_estimate_status_event(
            estimate=estimate,
            from_status=previous_status,
            to_status=estimate.status,
            note=status_note,
            changed_by=request.user,
        )

    estimate.refresh_from_db()
    return Response({"data": EstimateSerializer(estimate).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def estimate_clone_version_view(request, estimate_id: int):
    try:
        estimate = Estimate.objects.prefetch_related("line_items").get(
            id=estimate_id,
            created_by=request.user,
        )
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    latest = (
        Estimate.objects.filter(project=estimate.project, created_by=request.user)
        .order_by("-version")
        .first()
    )
    next_version = (latest.version + 1) if latest else (estimate.version + 1)

    cloned = Estimate.objects.create(
        project=estimate.project,
        created_by=request.user,
        version=next_version,
        status=Estimate.Status.DRAFT,
        title=estimate.title,
        tax_percent=estimate.tax_percent,
    )

    line_items = [
        {
            "cost_code": line.cost_code_id,
            "description": line.description,
            "quantity": line.quantity,
            "unit": line.unit,
            "unit_cost": line.unit_cost,
            "markup_percent": line.markup_percent,
        }
        for line in estimate.line_items.all()
    ]
    if line_items:
        _apply_estimate_lines_and_totals(
            estimate=cloned,
            line_items_data=line_items,
            tax_percent=estimate.tax_percent,
            user=request.user,
        )

    cloned.refresh_from_db()
    _record_estimate_status_event(
        estimate=cloned,
        from_status=None,
        to_status=cloned.status,
        note=f"Cloned from estimate #{estimate.id}.",
        changed_by=request.user,
    )
    return Response(
        {"data": EstimateSerializer(cloned).data, "meta": {"cloned_from": estimate.id}},
        status=201,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def estimate_status_events_view(request, estimate_id: int):
    try:
        estimate = Estimate.objects.get(id=estimate_id, created_by=request.user)
    except Estimate.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Estimate not found.", "fields": {}}},
            status=404,
        )

    events = EstimateStatusEvent.objects.filter(estimate=estimate).select_related("changed_by")
    return Response({"data": EstimateStatusEventSerializer(events, many=True).data})
