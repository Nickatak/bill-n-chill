"""Seed four demo accounts representing different adoption stages of the platform.

new@test.com   — Fresh signup. Empty workspace (org + cost codes only).
early@test.com — ~2 months in. A few customers, first projects, first estimates.
mid@test.com   — ~8 months in. One of each status for every entity type.
late@test.com  — ~2 years in. Full portfolio with history across all domains.

All accounts use password "a" and are idempotent (safe to re-run).
"""

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from rest_framework.authtoken.models import Token

from core.models import (
    Budget,
    BudgetLine,
    ChangeOrder,
    CostCode,
    Customer,
    Estimate,
    EstimateLineItem,
    EstimateStatusEvent,
    FinancialAuditEvent,
    Invoice,
    InvoiceLine,
    OrganizationMembership,
    OrganizationMembershipRecord,
    Payment,
    PaymentAllocation,
    Project,
    RoleTemplate,
    Vendor,
    VendorBill,
    VendorBillAllocation,
)
from core.user_helpers import _ensure_membership
from core.views.estimating.budgets_helpers import _build_budget_baseline_snapshot

User = get_user_model()

PASSWORD = "a"

CANONICAL_RETAIL_VENDORS = [
    "Home Depot",
    "Lowe's",
    "Menards",
    "Amazon Business",
    "Sherwin-Williams",
    "Floor & Decor",
    "Ferguson",
    "Ace Hardware",
]


class Command(BaseCommand):
    help = "Seed demo accounts at four adoption stages (new, early, mid, late)."

    # ── Helpers ──────────────────────────────────────────────────────────

    def _get_or_create_user(self, email):
        user, _ = User.objects.get_or_create(
            email=email,
            defaults={"username": email},
        )
        if not user.username:
            user.username = email
        user.set_password(PASSWORD)
        user.save(update_fields=["username", "password"])
        token, _ = Token.objects.get_or_create(user=user)
        membership = _ensure_membership(user)
        return user, token, membership

    def _cost_codes(self, user):
        """Return two cost codes for estimate/budget line seeding."""
        membership = _ensure_membership(user)
        codes = list(
            CostCode.objects.filter(organization=membership.organization, is_active=True)
            .order_by("code")[:2]
        )
        if len(codes) < 2:
            c1, _ = CostCode.objects.get_or_create(
                organization=membership.organization, code="01-100",
                defaults={"name": "General", "is_active": True, "created_by": user},
            )
            c2, _ = CostCode.objects.get_or_create(
                organization=membership.organization, code="03-100",
                defaults={"name": "Concrete", "is_active": True, "created_by": user},
            )
            codes = [c1, c2]
        return codes[0], codes[1]

    def _seed_canonical_vendors(self, user):
        for name in CANONICAL_RETAIL_VENDORS:
            v, _ = Vendor.objects.get_or_create(
                created_by=user, name=name,
                defaults={
                    "vendor_type": Vendor.VendorType.RETAIL,
                    "is_canonical": True,
                    "is_active": True,
                },
            )
            v.vendor_type = Vendor.VendorType.RETAIL
            v.is_canonical = True
            v.is_active = True
            v.save(update_fields=["vendor_type", "is_canonical", "is_active", "updated_at"])

    def _add_team_member(self, owner_membership, email, full_name, role):
        """Create a user and add them as a team member on the owner's org."""
        first, last = full_name.split(" ", 1) if " " in full_name else (full_name, "")
        member_user, _ = User.objects.get_or_create(
            email=email,
            defaults={"username": email, "first_name": first, "last_name": last},
        )
        member_user.set_password(PASSWORD)
        member_user.first_name = first
        member_user.last_name = last
        member_user.save(update_fields=["password", "first_name", "last_name"])
        Token.objects.get_or_create(user=member_user)
        membership, created = OrganizationMembership.objects.get_or_create(
            organization=owner_membership.organization,
            user=member_user,
            defaults={
                "role": role,
                "status": OrganizationMembership.Status.ACTIVE,
            },
        )
        if not created:
            membership.role = role
            membership.status = OrganizationMembership.Status.ACTIVE
            membership.save(update_fields=["role", "status", "updated_at"])
        OrganizationMembershipRecord.record(
            membership=membership,
            event_type=OrganizationMembershipRecord.EventType.CREATED,
            capture_source=OrganizationMembershipRecord.CaptureSource.AUTH_BOOTSTRAP,
            recorded_by=member_user,
            from_status=None,
            to_status=membership.status,
            from_role="",
            to_role=membership.role,
            note="Seeded team member.",
            metadata={"seed": True},
        )
        return membership

    def _make_customer(self, user, name, **kwargs):
        membership = _ensure_membership(user)
        c, _ = Customer.objects.get_or_create(
            organization=membership.organization, created_by=user, display_name=name,
            defaults={
                "email": kwargs.get("email", ""),
                "phone": kwargs.get("phone", ""),
                "billing_address": kwargs.get("billing_address", ""),
            },
        )
        for field in ("email", "phone", "billing_address"):
            if field in kwargs:
                setattr(c, field, kwargs[field])
        if "is_archived" in kwargs:
            c.is_archived = kwargs["is_archived"]
        c.save()
        return c

    def _make_project(self, user, customer, name, status, **kwargs):
        membership = _ensure_membership(user)
        p, _ = Project.objects.get_or_create(
            organization=membership.organization, created_by=user, customer=customer, name=name,
            defaults={
                "status": status,
                "site_address": kwargs.get("site_address", customer.billing_address or ""),
                "contract_value_original": kwargs.get("contract_value_original", Decimal("0.00")),
                "contract_value_current": kwargs.get("contract_value_current", Decimal("0.00")),
            },
        )
        p.status = status
        for field in ("site_address", "contract_value_original", "contract_value_current"):
            if field in kwargs:
                setattr(p, field, kwargs[field])
        p.save()
        return p

    def _make_estimate(self, user, project, title, version, status, subtotal, code1, code2):
        est, _ = Estimate.objects.get_or_create(
            created_by=user, project=project, title=title, version=version,
            defaults={
                "status": status,
                "subtotal": subtotal,
                "markup_total": Decimal("0.00"),
                "tax_percent": Decimal("0.00"),
                "tax_total": Decimal("0.00"),
                "grand_total": subtotal,
            },
        )
        est.status = status
        est.subtotal = subtotal
        est.markup_total = Decimal("0.00")
        est.tax_percent = Decimal("0.00")
        est.tax_total = Decimal("0.00")
        est.grand_total = subtotal
        est.save(update_fields=[
            "status", "subtotal", "markup_total", "tax_percent",
            "tax_total", "grand_total", "updated_at",
        ])
        self._sync_estimate_lines(est, code1, code2, subtotal)
        self._sync_estimate_status_history(est, status, user)
        return est

    def _sync_estimate_lines(self, estimate, code1, code2, subtotal):
        subtotal = Decimal(subtotal).quantize(Decimal("0.01"))
        primary_total = (subtotal * Decimal("0.40")).quantize(Decimal("0.01"))
        secondary_total = subtotal - primary_total
        specs = [
            (code1, f"{estimate.title} — {code1.name}", primary_total),
            (code2, f"{estimate.title} — {code2.name}", secondary_total),
        ]
        keep_ids = []
        for cost_code, description, line_total in specs:
            line, _ = EstimateLineItem.objects.get_or_create(
                estimate=estimate, cost_code=cost_code, description=description,
                defaults={
                    "quantity": Decimal("1.00"),
                    "unit": "ea",
                    "unit_cost": line_total,
                    "markup_percent": Decimal("0.00"),
                    "line_total": line_total,
                },
            )
            line.quantity = Decimal("1.00")
            line.unit = "ea"
            line.unit_cost = line_total
            line.markup_percent = Decimal("0.00")
            line.line_total = line_total
            line.save(update_fields=[
                "quantity", "unit", "unit_cost", "markup_percent", "line_total", "updated_at",
            ])
            keep_ids.append(line.id)
        EstimateLineItem.objects.filter(estimate=estimate).exclude(id__in=keep_ids).delete()

    def _sync_estimate_status_history(self, estimate, target_status, user):
        history = {
            Estimate.Status.DRAFT: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
            ],
            Estimate.Status.SENT: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to customer."),
            ],
            Estimate.Status.APPROVED: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to customer."),
                (Estimate.Status.SENT, Estimate.Status.APPROVED, "Estimate approved by customer."),
            ],
            Estimate.Status.REJECTED: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to customer."),
                (Estimate.Status.SENT, Estimate.Status.REJECTED, "Estimate rejected by customer."),
            ],
            Estimate.Status.ARCHIVED: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to customer."),
                (Estimate.Status.SENT, Estimate.Status.REJECTED, "Estimate rejected by customer."),
                (Estimate.Status.REJECTED, Estimate.Status.ARCHIVED, "Rejected version archived."),
            ],
            Estimate.Status.VOID: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.VOID, "Estimate voided."),
            ],
        }
        events = history.get(target_status, history[Estimate.Status.DRAFT])
        EstimateStatusEvent.objects.filter(estimate=estimate).delete()
        for from_s, to_s, note in events:
            EstimateStatusEvent.objects.create(
                estimate=estimate, from_status=from_s, to_status=to_s,
                note=note, changed_by=user,
            )

    def _make_budget(self, user, project, estimate, co_total=Decimal("0.00")):
        budget, _ = Budget.objects.get_or_create(
            created_by=user, project=project, source_estimate=estimate,
            defaults={
                "status": Budget.Status.ACTIVE,
                "baseline_snapshot_json": _build_budget_baseline_snapshot(estimate),
                "approved_change_order_total": co_total,
            },
        )
        budget.status = Budget.Status.ACTIVE
        budget.baseline_snapshot_json = _build_budget_baseline_snapshot(estimate)
        budget.approved_change_order_total = co_total
        budget.save(update_fields=[
            "status", "baseline_snapshot_json", "approved_change_order_total", "updated_at",
        ])
        # Create budget lines from estimate lines
        for line in EstimateLineItem.objects.filter(estimate=estimate):
            bl, _ = BudgetLine.objects.get_or_create(
                budget=budget, cost_code=line.cost_code, description=line.description,
                defaults={"budget_amount": line.line_total},
            )
            bl.budget_amount = line.line_total
            bl.save(update_fields=["budget_amount", "updated_at"])
        return budget

    def _make_change_order(self, user, project, family_key, title, status, amount, **kwargs):
        co, _ = ChangeOrder.objects.get_or_create(
            project=project, family_key=family_key,
            defaults={
                "title": title,
                "status": status,
                "amount_delta": amount,
                "days_delta": kwargs.get("days_delta", 0),
                "reason": kwargs.get("reason", title),
                "requested_by": user,
                "approved_by": user if status == ChangeOrder.Status.APPROVED else None,
                "approved_at": timezone.now() if status == ChangeOrder.Status.APPROVED else None,
            },
        )
        co.title = title
        co.status = status
        co.amount_delta = amount
        co.days_delta = kwargs.get("days_delta", 0)
        co.reason = kwargs.get("reason", title)
        co.requested_by = user
        co.approved_by = user if status == ChangeOrder.Status.APPROVED else None
        co.approved_at = timezone.now() if status == ChangeOrder.Status.APPROVED else None
        co.save()
        return co

    def _make_invoice(self, user, project, customer, number, status, total, balance_due, **kwargs):
        today = date.today()
        inv, _ = Invoice.objects.get_or_create(
            project=project, invoice_number=number,
            defaults={
                "customer": customer,
                "status": status,
                "issue_date": kwargs.get("issue_date", today),
                "due_date": kwargs.get("due_date", today + timedelta(days=30)),
                "subtotal": total,
                "tax_percent": Decimal("0.00"),
                "tax_total": Decimal("0.00"),
                "total": total,
                "balance_due": balance_due,
                "created_by": user,
            },
        )
        inv.customer = customer
        inv.status = status
        inv.issue_date = kwargs.get("issue_date", today)
        inv.due_date = kwargs.get("due_date", today + timedelta(days=30))
        inv.subtotal = total
        inv.tax_percent = Decimal("0.00")
        inv.tax_total = Decimal("0.00")
        inv.total = total
        inv.balance_due = balance_due
        inv.created_by = user
        inv.save()
        # Single line item per invoice
        code = kwargs.get("cost_code")
        if code:
            InvoiceLine.objects.get_or_create(
                invoice=inv, description=f"Draw — {number}",
                defaults={
                    "cost_code": code,
                    "quantity": Decimal("1.00"),
                    "unit": "ea",
                    "unit_price": total,
                    "line_total": total,
                },
            )
        return inv

    def _make_vendor_bill(self, user, project, vendor, bill_number, status, total, balance_due, **kwargs):
        today = date.today()
        vb, _ = VendorBill.objects.get_or_create(
            project=project, vendor=vendor, bill_number=bill_number,
            defaults={
                "status": status,
                "issue_date": kwargs.get("issue_date", today),
                "due_date": kwargs.get("due_date", today + timedelta(days=21)),
                "scheduled_for": (
                    today + timedelta(days=10)
                    if status in {VendorBill.Status.SCHEDULED, VendorBill.Status.PAID}
                    else None
                ),
                "total": total,
                "balance_due": balance_due,
                "notes": kwargs.get("notes", ""),
                "created_by": user,
            },
        )
        vb.status = status
        vb.issue_date = kwargs.get("issue_date", today)
        vb.due_date = kwargs.get("due_date", today + timedelta(days=21))
        vb.scheduled_for = (
            today + timedelta(days=10)
            if status in {VendorBill.Status.SCHEDULED, VendorBill.Status.PAID}
            else None
        )
        vb.total = total
        vb.balance_due = balance_due
        vb.notes = kwargs.get("notes", "")
        vb.created_by = user
        vb.save()
        return vb

    def _make_payment(self, user, project, direction, ref, method, status, amount, **kwargs):
        today = date.today()
        p, _ = Payment.objects.get_or_create(
            project=project, direction=direction, reference_number=ref,
            defaults={
                "method": method,
                "status": status,
                "amount": amount,
                "payment_date": kwargs.get("payment_date", today),
                "notes": kwargs.get("notes", ""),
                "created_by": user,
            },
        )
        p.method = method
        p.status = status
        p.amount = amount
        p.payment_date = kwargs.get("payment_date", today)
        p.notes = kwargs.get("notes", "")
        p.created_by = user
        p.save()
        return p

    def _allocate_payment(self, user, payment, invoice=None, vendor_bill=None, amount=None):
        target_type = (
            PaymentAllocation.TargetType.INVOICE
            if invoice
            else PaymentAllocation.TargetType.VENDOR_BILL
        )
        PaymentAllocation.objects.get_or_create(
            payment=payment,
            target_type=target_type,
            invoice=invoice,
            vendor_bill=vendor_bill,
            defaults={"applied_amount": amount or payment.amount, "created_by": user},
        )

    def _audit(self, project, user, event_type, object_type, object_id, note, **kwargs):
        if FinancialAuditEvent.objects.filter(
            project=project, created_by=user, event_type=event_type,
            object_type=object_type, object_id=object_id, note=note,
        ).exists():
            return
        FinancialAuditEvent.objects.create(
            project=project, created_by=user, event_type=event_type,
            object_type=object_type, object_id=object_id, note=note,
            from_status=kwargs.get("from_status", ""),
            to_status=kwargs.get("to_status", ""),
            amount=kwargs.get("amount"),
            metadata_json=kwargs.get("metadata", {}),
        )

    # ── Stage: New ───────────────────────────────────────────────────────

    def _seed_new(self):
        """Fresh signup. Org + cost codes bootstrapped, nothing else."""
        user, token, membership = self._get_or_create_user("new@test.com")
        self._seed_canonical_vendors(user)
        self.stdout.write(self.style.SUCCESS("  new@test.com — empty workspace"))
        return user, token

    # ── Stage: Early ─────────────────────────────────────────────────────

    def _seed_early(self):
        """~2 months in. First customers, first projects, first estimates."""
        user, token, membership = self._get_or_create_user("early@test.com")
        self._seed_canonical_vendors(user)
        code1, code2 = self._cost_codes(user)

        # 4 customers
        c_johnson = self._make_customer(user, "Johnson Family",
            email="johnson@example.com", phone="555-0201",
            billing_address="140 Oak St")
        c_martinez = self._make_customer(user, "Martinez Residence",
            email="martinez@example.com", phone="555-0202",
            billing_address="220 Pine Ave")
        self._make_customer(user, "Chen Property Group",
            email="chen@example.com", phone="555-0203",
            billing_address="88 Elm Blvd")
        self._make_customer(user, "Williams Home",
            email="williams@example.com", phone="555-0204",
            billing_address="305 Cedar Ln")

        # 2 projects: 1 prospect, 1 active
        p_prospect = self._make_project(user, c_johnson, "Johnson Kitchen Remodel",
            Project.Status.PROSPECT,
            site_address="140 Oak St",
            contract_value_original=Decimal("0.00"),
            contract_value_current=Decimal("0.00"))
        p_active = self._make_project(user, c_martinez, "Martinez Bathroom Renovation",
            Project.Status.ACTIVE,
            site_address="220 Pine Ave",
            contract_value_original=Decimal("8500.00"),
            contract_value_current=Decimal("8500.00"))

        # 2 estimates: 1 draft (prospect), 1 sent (active)
        self._make_estimate(user, p_prospect, "Kitchen Remodel Scope", 1,
            Estimate.Status.DRAFT, Decimal("12000.00"), code1, code2)
        self._make_estimate(user, p_active, "Bathroom Renovation Scope", 1,
            Estimate.Status.SENT, Decimal("8500.00"), code1, code2)

        # 1 custom vendor
        Vendor.objects.get_or_create(
            created_by=user, name="Pacific Tile & Stone",
            defaults={
                "organization": membership.organization,
                "vendor_type": Vendor.VendorType.TRADE,
                "is_canonical": False,
                "email": "orders@pacifictile.example",
            },
        )

        self.stdout.write(self.style.SUCCESS(
            "  early@test.com — 4 customers, 2 projects, 2 estimates, 1 vendor"
        ))
        return user, token

    # ── Stage: Mid ───────────────────────────────────────────────────────

    def _seed_mid(self):
        """~8 months in. One of each status for every entity type."""
        user, token, membership = self._get_or_create_user("mid@test.com")
        self._seed_canonical_vendors(user)
        code1, code2 = self._cost_codes(user)
        today = date.today()

        # 12 customers (1 archived)
        customers_data = [
            ("Anderson Residence", "anderson@example.com", "555-1001", "100 Main St"),
            ("Baker Construction", "baker@example.com", "555-1002", "201 Birch Dr"),
            ("Clark Family", "clark@example.com", "555-1003", "302 Spruce Way"),
            ("Davis Property", "davis@example.com", "555-1004", "403 Walnut Ct"),
            ("Evans Home", "evans@example.com", "555-1005", "504 Ash Blvd"),
            ("Foster Group", "foster@example.com", "555-1006", "605 Maple Rd"),
            ("Garcia Residence", "garcia@example.com", "555-1007", "706 Cherry Ln"),
            ("Harris Builders", "harris@example.com", "555-1008", "807 Poplar Ave"),
            ("Ingram Family", "ingram@example.com", "555-1009", "908 Willow St"),
            ("Jones Estate", "jones@example.com", "555-1010", "1009 Sycamore Dr"),
            ("Kim Property", "kim@example.com", "555-1011", "1110 Magnolia Way"),
            ("Lopez Renovation", "lopez@example.com", "555-1012", "1211 Hickory Ct"),
        ]
        mid_customers = []
        for name, email, phone, address in customers_data:
            c = self._make_customer(user, name, email=email, phone=phone, billing_address=address)
            mid_customers.append(c)
        # Archive the last customer
        mid_customers[-1].is_archived = True
        mid_customers[-1].save(update_fields=["is_archived", "updated_at"])

        # 6 projects across all statuses
        p_prospect = self._make_project(user, mid_customers[0], "Anderson Master Bath",
            Project.Status.PROSPECT, site_address="100 Main St")
        p_active1 = self._make_project(user, mid_customers[1], "Baker Office Build-out",
            Project.Status.ACTIVE, site_address="201 Birch Dr",
            contract_value_original=Decimal("24000.00"),
            contract_value_current=Decimal("26500.00"))
        p_active2 = self._make_project(user, mid_customers[2], "Clark Kitchen Remodel",
            Project.Status.ACTIVE, site_address="302 Spruce Way",
            contract_value_original=Decimal("18000.00"),
            contract_value_current=Decimal("18000.00"))
        p_hold = self._make_project(user, mid_customers[3], "Davis Deck Addition",
            Project.Status.ON_HOLD, site_address="403 Walnut Ct",
            contract_value_original=Decimal("9500.00"),
            contract_value_current=Decimal("9500.00"))
        p_completed = self._make_project(user, mid_customers[4], "Evans Garage Conversion",
            Project.Status.COMPLETED, site_address="504 Ash Blvd",
            contract_value_original=Decimal("32000.00"),
            contract_value_current=Decimal("33200.00"))
        p_cancelled = self._make_project(user, mid_customers[5], "Foster Basement Finish",
            Project.Status.CANCELLED, site_address="605 Maple Rd",
            contract_value_original=Decimal("15000.00"),
            contract_value_current=Decimal("15000.00"))

        # Estimate family on active project (v1 archived → v2 rejected → v3 approved)
        self._make_estimate(user, p_active1, "Baker Office Scope", 1,
            Estimate.Status.ARCHIVED, Decimal("22000.00"), code1, code2)
        self._make_estimate(user, p_active1, "Baker Office Scope", 2,
            Estimate.Status.REJECTED, Decimal("23500.00"), code1, code2)
        est_approved = self._make_estimate(user, p_active1, "Baker Office Scope", 3,
            Estimate.Status.APPROVED, Decimal("24000.00"), code1, code2)

        # Budget from the approved estimate
        budget = self._make_budget(user, p_active1, est_approved, co_total=Decimal("2500.00"))
        budget_lines = list(BudgetLine.objects.filter(budget=budget).order_by("id"))

        # More estimates in other statuses
        self._make_estimate(user, p_prospect, "Anderson Bath Scope", 1,
            Estimate.Status.DRAFT, Decimal("14000.00"), code1, code2)
        self._make_estimate(user, p_active2, "Clark Kitchen Scope", 1,
            Estimate.Status.SENT, Decimal("18000.00"), code1, code2)
        est_completed = self._make_estimate(user, p_completed, "Evans Garage Scope", 1,
            Estimate.Status.APPROVED, Decimal("32000.00"), code1, code2)
        self._make_estimate(user, p_cancelled, "Foster Basement Scope", 1,
            Estimate.Status.VOID, Decimal("15000.00"), code1, code2)
        self._make_estimate(user, p_hold, "Davis Deck Scope", 1,
            Estimate.Status.APPROVED, Decimal("9500.00"), code1, code2)

        # Budget for the completed project
        self._make_budget(user, p_completed, est_completed, co_total=Decimal("1200.00"))

        # Change orders: draft, pending, approved, rejected, void
        self._make_change_order(user, p_active1, "1", "Add conference room outlets",
            ChangeOrder.Status.APPROVED, Decimal("2500.00"), days_delta=2)
        self._make_change_order(user, p_active1, "2", "Upgrade lighting fixtures",
            ChangeOrder.Status.DRAFT, Decimal("800.00"))
        self._make_change_order(user, p_active1, "3", "Add network drops",
            ChangeOrder.Status.PENDING_APPROVAL, Decimal("1200.00"))
        self._make_change_order(user, p_completed, "1", "Garage door upgrade",
            ChangeOrder.Status.APPROVED, Decimal("1200.00"), days_delta=1)
        self._make_change_order(user, p_completed, "2", "Cancel window relocation",
            ChangeOrder.Status.VOID, Decimal("600.00"))

        # Invoices across statuses
        self._make_invoice(user, p_active1, mid_customers[1], "INV-001",
            Invoice.Status.DRAFT, Decimal("6000.00"), Decimal("6000.00"),
            cost_code=code1)
        self._make_invoice(user, p_active1, mid_customers[1], "INV-002",
            Invoice.Status.SENT, Decimal("8000.00"), Decimal("8000.00"),
            cost_code=code2)
        self._make_invoice(user, p_active1, mid_customers[1], "INV-003",
            Invoice.Status.PARTIALLY_PAID, Decimal("5000.00"), Decimal("2000.00"),
            cost_code=code1)
        inv_paid = self._make_invoice(user, p_completed, mid_customers[4], "INV-004",
            Invoice.Status.PAID, Decimal("16000.00"), Decimal("0.00"),
            cost_code=code2)
        self._make_invoice(user, p_cancelled, mid_customers[5], "INV-005",
            Invoice.Status.VOID, Decimal("5000.00"), Decimal("0.00"),
            cost_code=code1)

        # Custom vendors
        v_trade1, _ = Vendor.objects.get_or_create(
            created_by=user, name="Summit Electrical",
            defaults={"organization": membership.organization, "vendor_type": Vendor.VendorType.TRADE,
                       "is_canonical": False, "email": "billing@summitelec.example"},
        )
        v_trade2, _ = Vendor.objects.get_or_create(
            created_by=user, name="Valley Plumbing Supply",
            defaults={"organization": membership.organization, "vendor_type": Vendor.VendorType.TRADE,
                       "is_canonical": False, "email": "orders@valleyplumb.example"},
        )
        Vendor.objects.get_or_create(
            created_by=user, name="Metro Lumber Co",
            defaults={"organization": membership.organization, "vendor_type": Vendor.VendorType.TRADE,
                       "is_canonical": False, "email": "sales@metrolumber.example"},
        )

        # Vendor bills across statuses
        self._make_vendor_bill(user, p_active1, v_trade1, "VB-001",
            VendorBill.Status.RECEIVED, Decimal("3200.00"), Decimal("3200.00"),
            notes="Electrical rough-in materials.")
        vb_approved = self._make_vendor_bill(user, p_active1, v_trade2, "VB-002",
            VendorBill.Status.APPROVED, Decimal("1800.00"), Decimal("1800.00"),
            notes="Plumbing fixtures.")
        vb_paid = self._make_vendor_bill(user, p_completed, v_trade1, "VB-003",
            VendorBill.Status.PAID, Decimal("4500.00"), Decimal("0.00"),
            notes="Final electrical install.")
        self._make_vendor_bill(user, p_cancelled, v_trade2, "VB-004",
            VendorBill.Status.VOID, Decimal("2000.00"), Decimal("0.00"),
            notes="Cancelled with project.")
        self._make_vendor_bill(user, p_active1, v_trade1, "VB-005",
            VendorBill.Status.PLANNED, Decimal("1500.00"), Decimal("1500.00"),
            notes="Upcoming material order.")
        self._make_vendor_bill(user, p_active1, v_trade2, "VB-006",
            VendorBill.Status.SCHEDULED, Decimal("2200.00"), Decimal("2200.00"),
            notes="Scheduled plumbing payment.")

        # Vendor bill allocations for approved/scheduled/paid bills
        if budget_lines:
            for vb in [vb_approved, vb_paid]:
                VendorBillAllocation.objects.get_or_create(
                    vendor_bill=vb, budget_line=budget_lines[0],
                    defaults={"amount": vb.total, "note": "Seeded allocation."},
                )

        # Payments
        pay_in = self._make_payment(user, p_completed, Payment.Direction.INBOUND,
            "AR-001", Payment.Method.ACH, Payment.Status.SETTLED, Decimal("16000.00"))
        self._allocate_payment(user, pay_in, invoice=inv_paid)
        pay_out = self._make_payment(user, p_completed, Payment.Direction.OUTBOUND,
            "AP-001", Payment.Method.CHECK, Payment.Status.SETTLED, Decimal("4500.00"))
        self._allocate_payment(user, pay_out, vendor_bill=vb_paid)
        self._make_payment(user, p_active1, Payment.Direction.INBOUND,
            "AR-002", Payment.Method.CARD, Payment.Status.PENDING, Decimal("3000.00"))

        # Audit events for the completed project
        self._audit(p_completed, user,
            FinancialAuditEvent.EventType.INVOICE_UPDATED,
            "invoice", inv_paid.id, "Invoice paid in full.",
            from_status=Invoice.Status.SENT, to_status=Invoice.Status.PAID,
            amount=inv_paid.total)

        # Team members (3 total: owner + PM + worker)
        self._add_team_member(membership, "mid-pm@test.com", "Sarah Chen",
            OrganizationMembership.Role.PM)
        self._add_team_member(membership, "mid-worker@test.com", "Jake Rivera",
            OrganizationMembership.Role.WORKER)

        self.stdout.write(self.style.SUCCESS(
            "  mid@test.com — 12 customers, 6 projects, 3 team members"
        ))
        return user, token

    # ── Stage: Late ──────────────────────────────────────────────────────

    def _seed_late(self):
        """~2 years in. Full portfolio with history across all domains."""
        user, token, membership = self._get_or_create_user("late@test.com")
        self._seed_canonical_vendors(user)
        code1, code2 = self._cost_codes(user)
        today = date.today()

        # 35 customers (3 archived)
        late_customer_names = [
            ("Abrams Renovation", "abrams@example.com", "555-2001", "10 First Ave"),
            ("Brennan Home", "brennan@example.com", "555-2002", "20 Second St"),
            ("Campbell Property", "campbell@example.com", "555-2003", "30 Third Blvd"),
            ("Dixon Estate", "dixon@example.com", "555-2004", "40 Fourth Dr"),
            ("Ellis Construction", "ellis@example.com", "555-2005", "50 Fifth Ln"),
            ("Fitzgerald Group", "fitzgerald@example.com", "555-2006", "60 Sixth Ave"),
            ("Grant Residence", "grant@example.com", "555-2007", "70 Seventh St"),
            ("Holland Builders", "holland@example.com", "555-2008", "80 Eighth Blvd"),
            ("Irwin Family", "irwin@example.com", "555-2009", "90 Ninth Dr"),
            ("Jensen Property", "jensen@example.com", "555-2010", "100 Tenth Ln"),
            ("Kelley Home", "kelley@example.com", "555-2011", "110 Eleventh Ave"),
            ("Lambert Group", "lambert@example.com", "555-2012", "120 Twelfth St"),
            ("Mitchell Estate", "mitchell@example.com", "555-2013", "130 Oak Ave"),
            ("Nelson Residence", "nelson@example.com", "555-2014", "140 Pine St"),
            ("O'Brien Builders", "obrien@example.com", "555-2015", "150 Elm Blvd"),
            ("Palmer Property", "palmer@example.com", "555-2016", "160 Birch Dr"),
            ("Quinn Family", "quinn@example.com", "555-2017", "170 Cedar Ln"),
            ("Reed Construction", "reed@example.com", "555-2018", "180 Spruce Way"),
            ("Sullivan Home", "sullivan@example.com", "555-2019", "190 Walnut Ct"),
            ("Turner Group", "turner@example.com", "555-2020", "200 Ash Blvd"),
            ("Underwood Estate", "underwood@example.com", "555-2021", "210 Maple Rd"),
            ("Vargas Residence", "vargas@example.com", "555-2022", "220 Cherry Ln"),
            ("Wagner Property", "wagner@example.com", "555-2023", "230 Poplar Ave"),
            ("Xavier Builders", "xavier@example.com", "555-2024", "240 Willow St"),
            ("Young Family", "young@example.com", "555-2025", "250 Sycamore Dr"),
            ("Zimmerman Home", "zimmerman@example.com", "555-2026", "260 Magnolia Way"),
            ("Adams Renovation", "adams2@example.com", "555-2027", "270 Hickory Ct"),
            ("Brooks Property", "brooks@example.com", "555-2028", "280 Juniper Ln"),
            ("Cooper Group", "cooper@example.com", "555-2029", "290 Redwood Ave"),
            ("Dunn Estate", "dunn@example.com", "555-2030", "300 Sequoia Blvd"),
            ("Ford Construction", "ford@example.com", "555-2031", "310 Cypress Dr"),
            ("Gibson Home", "gibson@example.com", "555-2032", "320 Palm Way"),
            ("Hayes Builders", "hayes@example.com", "555-2033", "330 Olive Ct"),
            ("Ingram Residence", "ingram2@example.com", "555-2034", "340 Laurel St"),
            ("Joyce Property", "joyce@example.com", "555-2035", "350 Hazel Rd"),
        ]
        late_customers = []
        for name, email, phone, address in late_customer_names:
            c = self._make_customer(user, name, email=email, phone=phone, billing_address=address)
            late_customers.append(c)
        # Archive 3 customers (ones without projects)
        for c in late_customers[-3:]:
            c.is_archived = True
            c.save(update_fields=["is_archived", "updated_at"])

        # 18 projects across statuses — realistic distribution:
        # 3 prospect, 5 active, 2 on_hold, 6 completed, 2 cancelled
        project_specs = [
            (0, "Abrams Master Suite", Project.Status.PROSPECT, "0", "0"),
            (1, "Brennan Patio Enclosure", Project.Status.PROSPECT, "0", "0"),
            (2, "Campbell ADU Build", Project.Status.PROSPECT, "0", "0"),
            (3, "Dixon Whole Home Remodel", Project.Status.ACTIVE, "85000", "92000"),
            (4, "Ellis Commercial TI", Project.Status.ACTIVE, "120000", "127500"),
            (5, "Fitzgerald Kitchen & Bath", Project.Status.ACTIVE, "42000", "42000"),
            (6, "Grant Roof Replacement", Project.Status.ACTIVE, "28000", "28000"),
            (7, "Holland Office Renovation", Project.Status.ACTIVE, "65000", "68200"),
            (8, "Irwin Deck & Porch", Project.Status.ON_HOLD, "22000", "22000"),
            (9, "Jensen Basement Finish", Project.Status.ON_HOLD, "35000", "36500"),
            (10, "Kelley Garage Conversion", Project.Status.COMPLETED, "18000", "19200"),
            (11, "Lambert Pool House", Project.Status.COMPLETED, "55000", "58400"),
            (12, "Mitchell Bathroom Remodel", Project.Status.COMPLETED, "15000", "15000"),
            (13, "Nelson Siding Replacement", Project.Status.COMPLETED, "24000", "24800"),
            (14, "O'Brien Restaurant TI", Project.Status.COMPLETED, "95000", "102000"),
            (15, "Palmer Landscape Hardscape", Project.Status.COMPLETED, "32000", "32000"),
            (16, "Quinn Addition", Project.Status.CANCELLED, "45000", "45000"),
            (17, "Reed Warehouse Conversion", Project.Status.CANCELLED, "110000", "110000"),
        ]

        late_projects = []
        for c_idx, name, status, orig, current in project_specs:
            p = self._make_project(user, late_customers[c_idx], name, status,
                site_address=late_customers[c_idx].billing_address,
                contract_value_original=Decimal(orig),
                contract_value_current=Decimal(current))
            late_projects.append(p)

        # Estimates for every project — active/completed get full families
        budgets = {}
        for i, p in enumerate(late_projects):
            base_amount = Decimal(str(3000 + i * 2500))
            if p.status in {Project.Status.ACTIVE, Project.Status.COMPLETED}:
                # Full v1→v2→v3 family
                self._make_estimate(user, p, f"{p.name} Scope", 1,
                    Estimate.Status.ARCHIVED, base_amount * Decimal("0.90"), code1, code2)
                self._make_estimate(user, p, f"{p.name} Scope", 2,
                    Estimate.Status.REJECTED, base_amount * Decimal("0.95"), code1, code2)
                est = self._make_estimate(user, p, f"{p.name} Scope", 3,
                    Estimate.Status.APPROVED, base_amount, code1, code2)
                budgets[p.id] = self._make_budget(user, p, est)
            elif p.status == Project.Status.PROSPECT:
                self._make_estimate(user, p, f"{p.name} Scope", 1,
                    Estimate.Status.DRAFT, base_amount, code1, code2)
            elif p.status == Project.Status.ON_HOLD:
                est = self._make_estimate(user, p, f"{p.name} Scope", 1,
                    Estimate.Status.APPROVED, base_amount, code1, code2)
                budgets[p.id] = self._make_budget(user, p, est)
            elif p.status == Project.Status.CANCELLED:
                self._make_estimate(user, p, f"{p.name} Scope", 1,
                    Estimate.Status.VOID, base_amount, code1, code2)

        # Change orders on active + completed projects
        co_specs = [
            (3, "1", "Upgrade master fixtures", ChangeOrder.Status.APPROVED, "7000"),
            (3, "2", "Add mudroom entry", ChangeOrder.Status.PENDING_APPROVAL, "3500"),
            (4, "1", "Conference room AV upgrade", ChangeOrder.Status.APPROVED, "7500"),
            (4, "2", "Parking lot resurfacing", ChangeOrder.Status.DRAFT, "12000"),
            (7, "1", "Server room cooling", ChangeOrder.Status.APPROVED, "3200"),
            (10, "1", "Garage door opener upgrade", ChangeOrder.Status.APPROVED, "1200"),
            (11, "1", "Pool house kitchenette", ChangeOrder.Status.APPROVED, "3400"),
            (14, "1", "Kitchen hood upgrade", ChangeOrder.Status.APPROVED, "7000"),
            (14, "2", "Patio dining extension", ChangeOrder.Status.REJECTED, "15000"),
            (14, "3", "Walk-in cooler expansion", ChangeOrder.Status.VOID, "8000"),
            (16, "1", "Foundation change", ChangeOrder.Status.VOID, "6000"),
        ]
        for p_idx, fk, title, status, amt in co_specs:
            self._make_change_order(user, late_projects[p_idx], fk, title, status, Decimal(amt))

        # Invoices — multiple per active/completed project
        inv_num = 1
        # Active projects: draft + sent invoices
        for p_idx in [3, 4, 5, 6, 7]:
            p = late_projects[p_idx]
            c = late_customers[p_idx]
            self._make_invoice(user, p, c, f"INV-{inv_num:03d}",
                Invoice.Status.SENT, Decimal("8000.00"), Decimal("8000.00"),
                cost_code=code1)
            inv_num += 1
            self._make_invoice(user, p, c, f"INV-{inv_num:03d}",
                Invoice.Status.DRAFT, Decimal("6000.00"), Decimal("6000.00"),
                cost_code=code2)
            inv_num += 1

        # Completed projects: paid invoices
        paid_invoices = []
        for p_idx in [10, 11, 12, 13, 14, 15]:
            p = late_projects[p_idx]
            c = late_customers[p_idx]
            inv = self._make_invoice(user, p, c, f"INV-{inv_num:03d}",
                Invoice.Status.PAID, Decimal("12000.00"), Decimal("0.00"),
                cost_code=code1)
            paid_invoices.append(inv)
            inv_num += 1

        # One partially paid
        self._make_invoice(user, late_projects[3], late_customers[3], f"INV-{inv_num:03d}",
            Invoice.Status.PARTIALLY_PAID, Decimal("10000.00"), Decimal("4000.00"),
            cost_code=code2)
        inv_num += 1

        # One void
        self._make_invoice(user, late_projects[16], late_customers[16], f"INV-{inv_num:03d}",
            Invoice.Status.VOID, Decimal("15000.00"), Decimal("0.00"),
            cost_code=code1)

        # Custom vendors
        vendor_names = [
            ("Pinnacle Electric", Vendor.VendorType.TRADE, "billing@pinnacle.example"),
            ("Riverside Plumbing", Vendor.VendorType.TRADE, "ap@riverside.example"),
            ("Harbor HVAC Solutions", Vendor.VendorType.TRADE, "invoices@harborhvac.example"),
            ("Crestview Lumber", Vendor.VendorType.TRADE, "orders@crestview.example"),
            ("Summit Concrete", Vendor.VendorType.TRADE, "billing@summitconcrete.example"),
            ("Ironclad Roofing Supply", Vendor.VendorType.TRADE, "ap@ironclad.example"),
        ]
        late_vendors = []
        for vname, vtype, vemail in vendor_names:
            v, _ = Vendor.objects.get_or_create(
                created_by=user, name=vname,
                defaults={"organization": membership.organization, "vendor_type": vtype,
                           "is_canonical": False, "email": vemail},
            )
            late_vendors.append(v)

        # Vendor bills across projects and statuses
        vb_num = 1
        vb_specs = [
            (3, 0, VendorBill.Status.RECEIVED, "4200.00", "4200.00"),
            (3, 1, VendorBill.Status.APPROVED, "3800.00", "3800.00"),
            (4, 2, VendorBill.Status.SCHEDULED, "6500.00", "6500.00"),
            (4, 3, VendorBill.Status.PAID, "8200.00", "0.00"),
            (5, 0, VendorBill.Status.PLANNED, "2100.00", "2100.00"),
            (7, 1, VendorBill.Status.RECEIVED, "3500.00", "3500.00"),
            (10, 4, VendorBill.Status.PAID, "5000.00", "0.00"),
            (11, 5, VendorBill.Status.PAID, "7200.00", "0.00"),
            (14, 2, VendorBill.Status.PAID, "12000.00", "0.00"),
            (14, 3, VendorBill.Status.PAID, "8500.00", "0.00"),
            (16, 0, VendorBill.Status.VOID, "4000.00", "0.00"),
        ]
        paid_vendor_bills = []
        for p_idx, v_idx, status, total, balance in vb_specs:
            vb = self._make_vendor_bill(user, late_projects[p_idx], late_vendors[v_idx],
                f"VB-{vb_num:03d}", status, Decimal(total), Decimal(balance))
            if status == VendorBill.Status.PAID:
                paid_vendor_bills.append(vb)
            # Allocate approved/scheduled/paid bills to budget lines
            if status in {VendorBill.Status.APPROVED, VendorBill.Status.SCHEDULED, VendorBill.Status.PAID}:
                budget = budgets.get(late_projects[p_idx].id)
                if budget:
                    bl = BudgetLine.objects.filter(budget=budget).first()
                    if bl:
                        VendorBillAllocation.objects.get_or_create(
                            vendor_bill=vb, budget_line=bl,
                            defaults={"amount": vb.total, "note": "Seeded allocation."},
                        )
            vb_num += 1

        # Payments — inbound for paid invoices, outbound for paid vendor bills
        pay_num = 1
        for inv in paid_invoices:
            pay = self._make_payment(user, inv.project, Payment.Direction.INBOUND,
                f"AR-{pay_num:03d}", Payment.Method.ACH, Payment.Status.SETTLED,
                inv.total)
            self._allocate_payment(user, pay, invoice=inv)
            pay_num += 1
        for vb in paid_vendor_bills:
            pay = self._make_payment(user, vb.project, Payment.Direction.OUTBOUND,
                f"AP-{pay_num:03d}", Payment.Method.CHECK, Payment.Status.SETTLED,
                vb.total)
            self._allocate_payment(user, pay, vendor_bill=vb)
            pay_num += 1
        # A couple pending payments
        self._make_payment(user, late_projects[3], Payment.Direction.INBOUND,
            f"AR-{pay_num:03d}", Payment.Method.CARD, Payment.Status.PENDING,
            Decimal("6000.00"))
        pay_num += 1
        self._make_payment(user, late_projects[4], Payment.Direction.OUTBOUND,
            f"AP-{pay_num:03d}", Payment.Method.WIRE, Payment.Status.PENDING,
            Decimal("6500.00"))

        # Team members (6 total: owner + PM + bookkeeper + 2 workers + viewer)
        self._add_team_member(membership, "late-pm@test.com", "Maria Torres",
            OrganizationMembership.Role.PM)
        self._add_team_member(membership, "late-books@test.com", "David Park",
            OrganizationMembership.Role.BOOKKEEPING)
        self._add_team_member(membership, "late-worker1@test.com", "Chris Nguyen",
            OrganizationMembership.Role.WORKER)
        self._add_team_member(membership, "late-worker2@test.com", "Tyler Brooks",
            OrganizationMembership.Role.WORKER)
        self._add_team_member(membership, "late-viewer@test.com", "Amanda Ross",
            OrganizationMembership.Role.VIEWER)

        self.stdout.write(self.style.SUCCESS(
            "  late@test.com — 35 customers, 18 projects, 6 team members"
        ))
        return user, token

    # ── Entry point ──────────────────────────────────────────────────────

    @transaction.atomic
    def _seed_system_role_templates(self):
        """Ensure system RoleTemplate rows exist."""
        from core.utils.rbac_defaults import SYSTEM_ROLES

        for slug, data in SYSTEM_ROLES.items():
            RoleTemplate.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": data["name"],
                    "is_system": True,
                    "organization": None,
                    "capability_flags_json": data["capability_flags_json"],
                    "description": data["description"],
                    "created_by": None,
                },
            )
        self.stdout.write(f"  System RoleTemplates: {len(SYSTEM_ROLES)} ensured")

    def handle(self, *args, **options):
        self.stdout.write("Seeding adoption-stage demo accounts...")
        self.stdout.write("")

        self._seed_system_role_templates()

        accounts = [
            self._seed_new(),
            self._seed_early(),
            self._seed_mid(),
            self._seed_late(),
        ]

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("All accounts seeded."))
        self.stdout.write(f"Password: {PASSWORD}")
        self.stdout.write("")
        for user, token in accounts:
            self.stdout.write(f"  {user.email}  token={token.key}")
        self.stdout.write("")
        self.stdout.write("Entry points:")
        self.stdout.write("  /customers")
        self.stdout.write("  /projects")
