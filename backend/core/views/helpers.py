from decimal import Decimal

from django.contrib.auth.models import Group
from django.db import transaction
from django.db.models import Q
from django.db.models import Sum
from django.utils.text import slugify

from core.models import (
    Budget,
    BudgetLine,
    ChangeOrder,
    CostCode,
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    ScopeItem,
    FinancialAuditEvent,
    Invoice,
    InvoiceLine,
    InvoiceStatusEvent,
    InvoiceScopeOverrideEvent,
    Payment,
    Project,
    Organization,
    OrganizationMembership,
    OrganizationMembershipRecord,
    OrganizationRecord,
    VendorBill,
)
from core.policies.cost_codes import STARTER_COST_CODE_ROWS
from core.utils.money import MONEY_ZERO, quantize_money
from core.utils.organization_defaults import build_invoice_profile_defaults

BILLABLE_INVOICE_STATUSES = {
    Invoice.Status.SENT,
    Invoice.Status.PARTIALLY_PAID,
    Invoice.Status.PAID,
    Invoice.Status.OVERDUE,
}

RBAC_ROLE_OWNER = "owner"
RBAC_ROLE_PM = "pm"
RBAC_ROLE_BOOKKEEPING = "bookkeeping"
RBAC_ROLE_WORKER = "worker"
RBAC_ROLE_VIEWER = "viewer"
RBAC_ROLE_PRECEDENCE = [
    RBAC_ROLE_OWNER,
    RBAC_ROLE_PM,
    RBAC_ROLE_BOOKKEEPING,
    RBAC_ROLE_WORKER,
    RBAC_ROLE_VIEWER,
]

SYSTEM_BUDGET_LINE_SPECS = [
    {
        "cost_code": "99-901",
        "cost_code_name": "Project Tools & Consumables",
        "description": "System: Project tools and consumables (non-client-billable)",
    },
    {
        "cost_code": "99-902",
        "cost_code_name": "Project Overhead",
        "description": "System: Project overhead and indirect spend (non-client-billable)",
    },
    {
        "cost_code": "99-903",
        "cost_code_name": "Unplanned Project Spend",
        "description": "System: Unplanned project spend bucket (non-client-billable)",
    },
]
SYSTEM_BUDGET_LINE_CODES = {row["cost_code"] for row in SYSTEM_BUDGET_LINE_SPECS}


def _validate_project_for_user(project_id: int, user):
    actor_user_ids = _organization_user_ids(user)
    try:
        return Project.objects.select_related("customer").get(
            id=project_id,
            created_by_id__in=actor_user_ids,
        )
    except Project.DoesNotExist:
        return None


def _normalize_legacy_role(role: str) -> str:
    normalized = (role or "").strip().lower()
    if normalized == "manager":
        return RBAC_ROLE_PM
    if normalized == "accounting":
        return RBAC_ROLE_BOOKKEEPING
    if normalized == "reception":
        return RBAC_ROLE_VIEWER
    if normalized == "support":
        return RBAC_ROLE_VIEWER
    if normalized == "readonly":
        return RBAC_ROLE_VIEWER
    if normalized == "read_only":
        return RBAC_ROLE_VIEWER
    if normalized == "read-only":
        return RBAC_ROLE_VIEWER
    if normalized == "field":
        return RBAC_ROLE_WORKER
    if normalized == "field_worker":
        return RBAC_ROLE_WORKER
    if normalized == "field-worker":
        return RBAC_ROLE_WORKER
    if normalized == "labor":
        return RBAC_ROLE_WORKER
    if normalized == "labour":
        return RBAC_ROLE_WORKER
    if normalized == "crew":
        return RBAC_ROLE_WORKER
    if normalized == "worker":
        return RBAC_ROLE_WORKER
    if normalized == "owner":
        return RBAC_ROLE_OWNER
    if normalized == "pm":
        return RBAC_ROLE_PM
    if normalized == "bookkeeping":
        return RBAC_ROLE_BOOKKEEPING
    if normalized == "viewer":
        return RBAC_ROLE_VIEWER
    return normalized


def _default_org_name_for_user(user) -> str:
    seed = (user.email or user.username or f"user-{user.id}").split("@")[0].strip()
    humanized = seed.replace(".", " ").replace("_", " ").replace("-", " ").strip().title()
    return f"{humanized or 'New'} Organization"


def _next_org_slug(seed: str) -> str:
    base_slug = slugify(seed) or "org"
    candidate = base_slug
    suffix = 2
    while Organization.objects.filter(slug=candidate).exists():
        candidate = f"{base_slug}-{suffix}"
        suffix += 1
    return candidate


def _legacy_group_role(user) -> str | None:
    group_names = set(Group.objects.filter(user=user).values_list("name", flat=True))
    normalized_names = {_normalize_legacy_role(name.strip().lower()) for name in group_names}
    for role in RBAC_ROLE_PRECEDENCE:
        if role in normalized_names:
            return role
    return None


def _build_organization_snapshot(organization: Organization) -> dict:
    return {
        "organization": {
            "id": organization.id,
            "display_name": organization.display_name,
            "slug": organization.slug,
            "logo_url": organization.logo_url,
            "invoice_sender_name": organization.invoice_sender_name,
            "invoice_sender_email": organization.invoice_sender_email,
            "help_email": organization.help_email,
            "invoice_sender_address": organization.invoice_sender_address,
            "invoice_default_due_days": organization.invoice_default_due_days,
            "estimate_validation_delta_days": organization.estimate_validation_delta_days,
            "invoice_default_terms": organization.invoice_default_terms,
            "estimate_default_terms": organization.estimate_default_terms,
            "change_order_default_reason": organization.change_order_default_reason,
            "invoice_default_footer": organization.invoice_default_footer,
            "invoice_default_notes": organization.invoice_default_notes,
            "created_by_id": organization.created_by_id,
            "created_at": organization.created_at.isoformat() if organization.created_at else None,
        }
    }


def _build_organization_membership_snapshot(membership: OrganizationMembership) -> dict:
    return {
        "organization_membership": {
            "id": membership.id,
            "organization_id": membership.organization_id,
            "user_id": membership.user_id,
            "role": membership.role,
            "status": membership.status,
            "role_template_id": membership.role_template_id,
            "capability_flags_json": membership.capability_flags_json or {},
            "created_at": membership.created_at.isoformat() if membership.created_at else None,
        }
    }


def _record_organization_record(
    *,
    organization: Organization,
    event_type: str,
    capture_source: str,
    recorded_by,
    source_reference: str = "",
    note: str = "",
    metadata: dict | None = None,
):
    OrganizationRecord.objects.create(
        organization=organization,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        note=note,
        snapshot_json=_build_organization_snapshot(organization),
        metadata_json=metadata or {},
        recorded_by=recorded_by,
    )


def _record_organization_membership_record(
    *,
    membership: OrganizationMembership,
    event_type: str,
    capture_source: str,
    recorded_by,
    from_status: str | None = None,
    to_status: str | None = None,
    from_role: str = "",
    to_role: str = "",
    source_reference: str = "",
    note: str = "",
    metadata: dict | None = None,
):
    OrganizationMembershipRecord.objects.create(
        organization=membership.organization,
        organization_membership=membership,
        membership_user=membership.user,
        event_type=event_type,
        capture_source=capture_source,
        source_reference=source_reference,
        from_status=from_status,
        to_status=to_status,
        from_role=from_role,
        to_role=to_role,
        note=note,
        snapshot_json=_build_organization_membership_snapshot(membership),
        metadata_json=metadata or {},
        recorded_by=recorded_by,
    )


def _bootstrap_starter_cost_codes_for_organization(*, organization, created_by) -> int:
    created_count = 0
    for code, name in STARTER_COST_CODE_ROWS:
        _row, created = CostCode.objects.get_or_create(
            organization=organization,
            code=code,
            defaults={
                "name": name,
                "is_active": True,
                "created_by": created_by,
            },
        )
        if created:
            created_count += 1
    return created_count


def _ensure_primary_membership(user):
    membership = (
        OrganizationMembership.objects.select_related("organization")
        .filter(
            user=user,
            status=OrganizationMembership.Status.ACTIVE,
        )
        .first()
    )
    if membership:
        return membership

    with transaction.atomic():
        display_name = _default_org_name_for_user(user)
        bootstrap_invoice_defaults = build_invoice_profile_defaults(
            display_name=display_name,
            owner_email=user.email or "",
        )
        organization = Organization.objects.create(
            display_name=display_name,
            slug=_next_org_slug((user.email or user.username or f"user-{user.id}").split("@")[0]),
            invoice_sender_name=bootstrap_invoice_defaults["invoice_sender_name"],
            invoice_sender_email=bootstrap_invoice_defaults["invoice_sender_email"],
            help_email=bootstrap_invoice_defaults["help_email"],
            invoice_default_due_days=bootstrap_invoice_defaults["invoice_default_due_days"],
            estimate_validation_delta_days=bootstrap_invoice_defaults[
                "estimate_validation_delta_days"
            ],
            invoice_default_terms=bootstrap_invoice_defaults["invoice_default_terms"],
            estimate_default_terms=bootstrap_invoice_defaults["estimate_default_terms"],
            change_order_default_reason=bootstrap_invoice_defaults["change_order_default_reason"],
            invoice_default_footer=bootstrap_invoice_defaults["invoice_default_footer"],
            invoice_default_notes=bootstrap_invoice_defaults["invoice_default_notes"],
            created_by=user,
        )
        _record_organization_record(
            organization=organization,
            event_type=OrganizationRecord.EventType.CREATED,
            capture_source=OrganizationRecord.CaptureSource.AUTH_BOOTSTRAP,
            recorded_by=user,
            note="Organization bootstrap created during auth self-heal.",
            metadata={"bootstrap_reason": "missing_active_membership"},
        )
        bootstrap_role = _legacy_group_role(user) or OrganizationMembership.Role.OWNER
        membership = OrganizationMembership.objects.create(
            organization=organization,
            user=user,
            role=bootstrap_role,
            status=OrganizationMembership.Status.ACTIVE,
        )
        _record_organization_membership_record(
            membership=membership,
            event_type=OrganizationMembershipRecord.EventType.CREATED,
            capture_source=OrganizationMembershipRecord.CaptureSource.AUTH_BOOTSTRAP,
            recorded_by=user,
            from_status=None,
            to_status=membership.status,
            from_role="",
            to_role=membership.role,
            note="Organization membership bootstrap created during auth self-heal.",
            metadata={"bootstrap_reason": "missing_active_membership"},
        )
        _bootstrap_starter_cost_codes_for_organization(
            organization=organization,
            created_by=user,
        )
    return membership


def _resolve_organization_for_public_actor(actor_user):
    if not actor_user:
        return None
    membership = (
        OrganizationMembership.objects.select_related("organization")
        .filter(
            user=actor_user,
            status=OrganizationMembership.Status.ACTIVE,
        )
        .order_by("id")
        .first()
    )
    if membership and membership.organization_id:
        return membership.organization
    return Organization.objects.filter(created_by=actor_user).order_by("id").first()


def _serialize_public_organization_context(organization: Organization | None) -> dict:
    if not organization:
        return {
            "display_name": "",
            "logo_url": "",
            "sender_name": "",
            "sender_email": "",
            "sender_address": "",
            "help_email": "",
            "invoice_default_terms": "",
            "estimate_default_terms": "",
            "change_order_default_reason": "",
        }

    sender_name = (organization.invoice_sender_name or organization.display_name or "").strip()
    sender_email = (organization.invoice_sender_email or "").strip()
    return {
        "display_name": (organization.display_name or "").strip(),
        "logo_url": (organization.logo_url or "").strip(),
        "sender_name": sender_name,
        "sender_email": sender_email,
        "sender_address": (organization.invoice_sender_address or "").strip(),
        "help_email": (organization.help_email or sender_email).strip(),
        "invoice_default_terms": (organization.invoice_default_terms or "").strip(),
        "estimate_default_terms": (organization.estimate_default_terms or "").strip(),
        "change_order_default_reason": (organization.change_order_default_reason or "").strip(),
    }


def _serialize_public_project_context(project: Project) -> dict:
    customer = project.customer
    return {
        "id": project.id,
        "name": project.name,
        "status": project.status,
        "customer_display_name": customer.display_name,
        "customer_billing_address": customer.billing_address,
        "customer_email": customer.email,
        "customer_phone": customer.phone,
    }


def _resolve_user_role(user) -> str:
    membership = (
        OrganizationMembership.objects.filter(
            user=user,
            status=OrganizationMembership.Status.ACTIVE,
        )
        .only("role")
        .first()
    )
    if membership:
        return _normalize_legacy_role(membership.role)

    legacy_role = _legacy_group_role(user)
    if legacy_role:
        return legacy_role
    # Backward compatibility for existing users without explicit role assignment.
    return RBAC_ROLE_OWNER


def _organization_user_ids(user):
    membership = _ensure_primary_membership(user)
    user_ids = list(
        OrganizationMembership.objects.filter(
            organization_id=membership.organization_id,
            status=OrganizationMembership.Status.ACTIVE,
        ).values_list("user_id", flat=True)
    )
    if user.id not in user_ids:
        user_ids.append(user.id)
    return user_ids


def _role_gate_error_payload(user, allowed_roles):
    effective_role = _resolve_user_role(user)
    allowed_role_set = {_normalize_legacy_role(role.strip().lower()) for role in allowed_roles}
    if effective_role in allowed_role_set:
        return None, effective_role
    return (
        {
            "error": {
                "code": "forbidden",
                "message": "Your role is not allowed to perform this action.",
                "fields": {
                    "role": [
                        f"Required role in: {', '.join(sorted(allowed_role_set))}. Current role: {effective_role}."
                    ]
                },
            }
        },
        effective_role,
    )


def _parse_request_bool(raw_value, *, default: bool = True) -> bool:
    if raw_value is None:
        return default
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, int):
        return raw_value != 0

    normalized = str(raw_value).strip().lower()
    if not normalized:
        return default
    if normalized in {"true", "1", "yes", "y", "on"}:
        return True
    if normalized in {"false", "0", "no", "n", "off"}:
        return False
    return default


def _calculate_line_totals(line_items_data):
    subtotal = MONEY_ZERO
    markup_total = MONEY_ZERO
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_cost = Decimal(str(item["unit_cost"]))
        markup_percent = Decimal(str(item.get("markup_percent", 0)))
        # Markup can be applied before or after quantity multiplication:
        # q * u * (1 + m) == q * (u * (1 + m))
        base_total = quantize_money(quantity * unit_cost)
        line_markup = quantize_money(base_total * (markup_percent / Decimal("100")))
        line_total = quantize_money(base_total + line_markup)
        subtotal = quantize_money(subtotal + base_total)
        markup_total = quantize_money(markup_total + line_markup)
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
    membership = _ensure_primary_membership(user)
    actor_user_ids = _organization_user_ids(user)
    codes = CostCode.objects.filter(
        id__in=ids,
    ).filter(
        Q(organization_id=membership.organization_id) | Q(
            organization__isnull=True,
            created_by_id__in=actor_user_ids,
        )
    )
    code_map = {code.id: code for code in codes}
    missing = [cost_code_id for cost_code_id in ids if cost_code_id not in code_map]
    return code_map, missing


def _apply_estimate_lines_and_totals(estimate, line_items_data, tax_percent, user):
    normalized_items, subtotal, markup_total = _calculate_line_totals(line_items_data)
    code_map, missing = _resolve_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}
    membership = _ensure_primary_membership(user)

    tax_percent = Decimal(str(tax_percent))
    tax_total = quantize_money((subtotal + markup_total) * (tax_percent / Decimal("100")))
    grand_total = quantize_money(subtotal + markup_total + tax_total)

    estimate.line_items.all().delete()
    new_lines = []
    for item in normalized_items:
        description = (item.get("description") or "").strip()
        normalized_scope_name = " ".join(description.lower().split())
        unit_value = (item.get("unit") or "ea").strip().lower() or "ea"
        scope_item = None
        if normalized_scope_name:
            scope_item = (
                ScopeItem.objects.filter(
                    organization_id=membership.organization_id,
                    cost_code=code_map[item["cost_code"]],
                    normalized_name=normalized_scope_name,
                    unit=unit_value,
                )
                .order_by("id")
                .first()
            )
            if not scope_item:
                scope_item = ScopeItem.objects.create(
                    organization_id=membership.organization_id,
                    cost_code=code_map[item["cost_code"]],
                    name=description[:255],
                    normalized_name=normalized_scope_name,
                    unit=unit_value,
                    created_by=user,
                )

        new_lines.append(
            EstimateLineItem(
                estimate=estimate,
                scope_item=scope_item,
                cost_code=code_map[item["cost_code"]],
                description=description,
                quantity=item["quantity"],
                unit=unit_value,
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
    _record_financial_audit_event(
        project=estimate.project,
        event_type=FinancialAuditEvent.EventType.ESTIMATE_STATUS_CHANGED,
        object_type="estimate",
        object_id=estimate.id,
        from_status=from_status or "",
        to_status=to_status or "",
        note=note,
        created_by=changed_by,
        metadata={"version": estimate.version},
    )


def _record_invoice_status_event(*, invoice, from_status, to_status, note, changed_by):
    InvoiceStatusEvent.objects.create(
        invoice=invoice,
        from_status=from_status,
        to_status=to_status,
        note=note,
        changed_by=changed_by,
    )


def _record_financial_audit_event(
    *,
    project,
    event_type,
    object_type,
    object_id,
    created_by,
    from_status="",
    to_status="",
    amount=None,
    note="",
    metadata=None,
):
    FinancialAuditEvent.objects.create(
        project=project,
        event_type=event_type,
        object_type=object_type,
        object_id=object_id,
        from_status=from_status or "",
        to_status=to_status or "",
        amount=amount,
        note=note,
        metadata_json=metadata or {},
        created_by=created_by,
    )


def _next_change_order_family_key(*, project):
    existing_keys = ChangeOrder.objects.filter(project=project).values_list("family_key", flat=True)
    numeric_keys = []
    for key in existing_keys:
        key_str = str(key or "").strip()
        if key_str.isdigit():
            numeric_keys.append(int(key_str))
    return str((max(numeric_keys) + 1) if numeric_keys else 1)


def _is_billable_invoice_status(status):
    return status in BILLABLE_INVOICE_STATUSES


def _project_billable_invoices_total(*, project, user, exclude_invoice_id=None):
    actor_user_ids = _organization_user_ids(user)
    query = Invoice.objects.filter(
        project=project,
        created_by_id__in=actor_user_ids,
        status__in=BILLABLE_INVOICE_STATUSES,
    )
    if exclude_invoice_id:
        query = query.exclude(id=exclude_invoice_id)
    return quantize_money(query.aggregate(total=Sum("total")).get("total") or MONEY_ZERO)


def _enforce_invoice_scope_guard(
    *,
    invoice,
    project,
    user,
    candidate_status,
    candidate_total,
    scope_override,
    scope_override_note,
):
    if not _is_billable_invoice_status(candidate_status):
        return None

    approved_scope_limit = project.contract_value_current
    already_billed = _project_billable_invoices_total(
        project=project,
        user=user,
        exclude_invoice_id=invoice.id,
    )
    projected_billed_total = quantize_money(already_billed + Decimal(str(candidate_total)))

    if projected_billed_total <= approved_scope_limit:
        return None

    overage_amount = quantize_money(projected_billed_total - approved_scope_limit)
    if not scope_override:
        return {
            "error": {
                "code": "validation_error",
                "message": "Invoice total exceeds approved billable scope for this project.",
                "fields": {
                    "scope_override": [
                        "Set scope_override=true with a note to allow this exception."
                    ]
                },
            },
            "meta": {
                "approved_scope_limit": str(approved_scope_limit),
                "already_billed_total": str(already_billed),
                "projected_billed_total": str(projected_billed_total),
                "overage_amount": str(overage_amount),
            },
        }

    note = (scope_override_note or "").strip()
    if not note:
        return {
            "error": {
                "code": "validation_error",
                "message": "scope_override_note is required when scope_override is true.",
                "fields": {
                    "scope_override_note": ["Provide a non-empty audit note for this override."]
                },
            }
        }

    InvoiceScopeOverrideEvent.objects.create(
        invoice=invoice,
        note=note,
        approved_scope_limit=approved_scope_limit,
        projected_billed_total=projected_billed_total,
        overage_amount=overage_amount,
        created_by=user,
    )
    _record_financial_audit_event(
        project=project,
        event_type=FinancialAuditEvent.EventType.INVOICE_SCOPE_OVERRIDE,
        object_type="invoice",
        object_id=invoice.id,
        from_status=invoice.status,
        to_status=candidate_status,
        amount=overage_amount,
        note=note,
        created_by=user,
        metadata={
            "approved_scope_limit": str(approved_scope_limit),
            "already_billed_total": str(already_billed),
            "projected_billed_total": str(projected_billed_total),
            "overage_amount": str(overage_amount),
        },
    )
    return None


def _next_invoice_number(*, project, user):
    actor_user_ids = _organization_user_ids(user)
    next_number = (
        Invoice.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
        ).count()
        + 1
    )
    candidate = f"INV-{next_number:04d}"
    while Invoice.objects.filter(project=project, invoice_number=candidate).exists():
        next_number += 1
        candidate = f"INV-{next_number:04d}"
    return candidate


def _get_active_budget_for_project(*, project, user):
    actor_user_ids = _organization_user_ids(user)
    return (
        Budget.objects.filter(
            project=project,
            created_by_id__in=actor_user_ids,
            status=Budget.Status.ACTIVE,
        )
        .order_by("-created_at")
        .first()
    )


def _calculate_invoice_line_totals(line_items_data):
    subtotal = MONEY_ZERO
    normalized_items = []

    for item in line_items_data:
        quantity = Decimal(str(item["quantity"]))
        unit_price = Decimal(str(item["unit_price"]))
        line_total = quantize_money(quantity * unit_price)
        subtotal = quantize_money(subtotal + line_total)
        normalized_items.append(
            {
                **item,
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": line_total,
            }
        )

    return normalized_items, subtotal


def _resolve_invoice_cost_codes_for_user(user, line_items_data):
    ids = [item["cost_code"] for item in line_items_data if item.get("cost_code")]
    if not ids:
        return {}, []

    membership = _ensure_primary_membership(user)
    actor_user_ids = _organization_user_ids(user)
    codes = CostCode.objects.filter(
        id__in=ids,
    ).filter(
        Q(organization_id=membership.organization_id) | Q(
            organization__isnull=True,
            created_by_id__in=actor_user_ids,
        )
    )
    code_map = {code.id: code for code in codes}
    missing = [cost_code_id for cost_code_id in ids if cost_code_id not in code_map]
    return code_map, missing


def _resolve_invoice_scope_items_for_user(user, line_items_data):
    ids = [item["scope_item"] for item in line_items_data if item.get("scope_item")]
    if not ids:
        return {}, []

    membership = _ensure_primary_membership(user)
    rows = ScopeItem.objects.filter(id__in=ids, organization_id=membership.organization_id)
    item_map = {row.id: row for row in rows}
    missing = [scope_item_id for scope_item_id in ids if scope_item_id not in item_map]
    return item_map, missing


def _resolve_invoice_budget_lines_for_project(*, project, user, line_items_data):
    ids = [item["budget_line"] for item in line_items_data if item.get("budget_line")]
    if not ids:
        return {}, []

    actor_user_ids = _organization_user_ids(user)
    rows = BudgetLine.objects.select_related("cost_code", "scope_item").filter(
        id__in=ids,
        budget__project=project,
        budget__created_by_id__in=actor_user_ids,
        budget__status=Budget.Status.ACTIVE,
    )
    line_map = {row.id: row for row in rows}
    missing = [line_id for line_id in ids if line_id not in line_map]
    return line_map, missing


def _apply_invoice_lines_and_totals(invoice, line_items_data, tax_percent, user):
    normalized_items, subtotal = _calculate_invoice_line_totals(line_items_data)
    budget_line_map, missing_budget_lines = _resolve_invoice_budget_lines_for_project(
        project=invoice.project,
        user=user,
        line_items_data=normalized_items,
    )
    if missing_budget_lines:
        return {"missing_budget_lines": missing_budget_lines}
    code_map, missing = _resolve_invoice_cost_codes_for_user(user, normalized_items)
    if missing:
        return {"missing_cost_codes": missing}
    scope_item_map, missing_scope_items = _resolve_invoice_scope_items_for_user(
        user,
        normalized_items,
    )
    if missing_scope_items:
        return {"missing_scope_items": missing_scope_items}

    tax_percent = Decimal(str(tax_percent))
    tax_total = quantize_money(subtotal * (tax_percent / Decimal("100")))
    total = quantize_money(subtotal + tax_total)

    invoice.line_items.all().delete()
    new_lines = []
    invalid_lines = []
    for index, item in enumerate(normalized_items, start=1):
        line_type = item.get("line_type", InvoiceLine.LineType.SCOPE)
        adjustment_reason = (item.get("adjustment_reason") or "").strip()
        internal_note = (item.get("internal_note") or "").strip()
        budget_line_id = item.get("budget_line")
        budget_line = budget_line_map.get(budget_line_id) if budget_line_id else None
        cost_code_id = item.get("cost_code")
        cost_code = code_map.get(cost_code_id) if cost_code_id else None
        scope_item_id = item.get("scope_item")
        scope_item = scope_item_map.get(scope_item_id) if scope_item_id else None

        if line_type == InvoiceLine.LineType.SCOPE and not budget_line:
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "budget_line",
                    "message": "Scope lines require budget_line from the project's active budget.",
                }
            )
            continue
        if (
            line_type == InvoiceLine.LineType.SCOPE
            and budget_line
            and budget_line.cost_code
            and budget_line.cost_code.code in SYSTEM_BUDGET_LINE_CODES
        ):
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "budget_line",
                    "message": "Scope lines cannot use internal generic budget lines.",
                }
            )
            continue

        if line_type == InvoiceLine.LineType.ADJUSTMENT and not adjustment_reason:
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "adjustment_reason",
                    "message": "Adjustment lines require adjustment_reason.",
                }
            )
            continue

        if budget_line:
            if cost_code and budget_line.cost_code_id != cost_code.id:
                invalid_lines.append(
                    {
                        "line_index": index,
                        "field": "cost_code",
                        "message": "cost_code must match selected budget_line cost_code.",
                    }
                )
                continue
            if scope_item and budget_line.scope_item_id != scope_item.id:
                invalid_lines.append(
                    {
                        "line_index": index,
                        "field": "scope_item",
                        "message": "scope_item must match selected budget_line scope_item.",
                    }
                )
                continue
            cost_code = budget_line.cost_code
            scope_item = budget_line.scope_item

        if scope_item and cost_code and scope_item.cost_code_id != cost_code.id:
            invalid_lines.append(
                {
                    "line_index": index,
                    "field": "scope_item",
                    "message": "scope_item cost code must match the line cost_code when both are set.",
                }
            )
            continue

        new_lines.append(
            InvoiceLine(
                invoice=invoice,
                line_type=line_type,
                budget_line=budget_line,
                cost_code=cost_code,
                scope_item=scope_item,
                adjustment_reason=adjustment_reason,
                internal_note=internal_note,
                description=item["description"],
                quantity=item["quantity"],
                unit=item.get("unit", "ea"),
                unit_price=item["unit_price"],
                line_total=item["line_total"],
            )
        )

    if invalid_lines:
        return {"invalid_lines": invalid_lines}

    InvoiceLine.objects.bulk_create(new_lines)

    invoice.subtotal = subtotal
    invoice.tax_percent = tax_percent
    invoice.tax_total = tax_total
    invoice.total = total
    invoice.balance_due = MONEY_ZERO if invoice.status == Invoice.Status.PAID else total
    invoice.save(
        update_fields=[
            "subtotal",
            "tax_percent",
            "tax_total",
            "total",
            "balance_due",
            "updated_at",
        ]
    )
    return None


def _build_budget_baseline_snapshot(estimate):
    return {
        "estimate": {
            "id": estimate.id,
            "project_id": estimate.project_id,
            "version": estimate.version,
            "status": estimate.status,
            "title": estimate.title,
            "subtotal": str(estimate.subtotal),
            "markup_total": str(estimate.markup_total),
            "tax_percent": str(estimate.tax_percent),
            "tax_total": str(estimate.tax_total),
            "grand_total": str(estimate.grand_total),
            "created_at": estimate.created_at.isoformat(),
            "updated_at": estimate.updated_at.isoformat(),
        },
        "line_items": [
            {
                "estimate_line_item_id": line.id,
                "scope_item_id": line.scope_item_id,
                "cost_code_id": line.cost_code_id,
                "cost_code_code": line.cost_code.code,
                "cost_code_name": line.cost_code.name,
                "description": line.description,
                "quantity": str(line.quantity),
                "unit": line.unit,
                "unit_cost": str(line.unit_cost),
                "markup_percent": str(line.markup_percent),
                "line_total": str(line.line_total),
            }
            for line in estimate.line_items.all()
        ],
    }


def _supersede_active_project_budgets(*, project, user, superseded_by_estimate=None):
    actor_user_ids = _organization_user_ids(user)
    active_budgets = Budget.objects.filter(
        project=project,
        created_by_id__in=actor_user_ids,
        status=Budget.Status.ACTIVE,
    ).select_related("source_estimate")
    for budget in active_budgets:
        previous_status = budget.status
        budget.status = Budget.Status.SUPERSEDED
        budget.save(update_fields=["status", "updated_at"])
        superseded_by_label = ""
        metadata = {
            "superseded_budget_id": budget.id,
            "superseded_source_estimate_id": budget.source_estimate_id,
            "superseded_source_estimate_version": budget.source_estimate.version,
        }
        if superseded_by_estimate is not None:
            superseded_by_label = (
                f" by estimate #{superseded_by_estimate.id} (v{superseded_by_estimate.version})"
            )
            metadata["superseded_by_estimate_id"] = superseded_by_estimate.id
            metadata["superseded_by_estimate_version"] = superseded_by_estimate.version
        _record_financial_audit_event(
            project=project,
            event_type=FinancialAuditEvent.EventType.BUDGET_CONVERTED,
            object_type="budget",
            object_id=budget.id,
            from_status=previous_status,
            to_status=budget.status,
            amount=budget.source_estimate.grand_total if budget.source_estimate_id else None,
            note=f"Budget #{budget.id} superseded{superseded_by_label}.",
            created_by=user,
            metadata=metadata,
        )


def _create_budget_from_estimate(*, estimate, user):
    _supersede_active_project_budgets(
        project=estimate.project,
        user=user,
        superseded_by_estimate=estimate,
    )
    budget = Budget.objects.create(
        project=estimate.project,
        status=Budget.Status.ACTIVE,
        source_estimate=estimate,
        baseline_snapshot_json=_build_budget_baseline_snapshot(estimate),
        created_by=user,
    )

    budget_lines = [
        BudgetLine(
            budget=budget,
            scope_item=line.scope_item,
            cost_code=line.cost_code,
            description=line.description,
            budget_amount=line.line_total,
        )
        for line in estimate.line_items.all()
    ]

    membership = _ensure_primary_membership(user)
    for spec in SYSTEM_BUDGET_LINE_SPECS:
        cost_code, _created = CostCode.objects.get_or_create(
            organization_id=membership.organization_id,
            code=spec["cost_code"],
            defaults={
                "name": spec["cost_code_name"],
                "is_active": True,
                "created_by": user,
            },
        )
        budget_lines.append(
            BudgetLine(
                budget=budget,
                scope_item=None,
                cost_code=cost_code,
                description=spec["description"],
                budget_amount=Decimal("0.00"),
            )
        )

    BudgetLine.objects.bulk_create(budget_lines)
    return budget
