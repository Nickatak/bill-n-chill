"""Seed four demo accounts representing different adoption stages of the platform.

new@test.com   — Fresh signup. Empty workspace (org + cost codes only).
early@test.com — ~2 months in. A few customers, first projects, first quotes.
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
    BillingPeriod,
    ChangeOrder,
    ChangeOrderLine,
    ChangeOrderSection,
    ChangeOrderStatusEvent,
    CostCode,
    Customer,
    Quote,
    QuoteLineItem,
    QuoteSection,
    QuoteStatusEvent,
    Invoice,
    InvoiceLine,
    OrganizationMembership,
    OrganizationMembershipRecord,
    Payment,
    Project,
    RoleTemplate,
    Vendor,
    VendorBill,
    VendorBillLine,
)
from core.user_helpers import _ensure_org_membership

User = get_user_model()

PASSWORD = "a"

class Command(BaseCommand):
    help = "Seed demo accounts at four adoption stages (new, early, mid, late)."

    # ── Helpers ──────────────────────────────────────────────────────────

    def _get_or_create_user(self, email, *, onboarding_completed=True):
        user, _ = User.objects.get_or_create(
            email=email,
            defaults={"username": email},
        )
        if not user.username:
            user.username = email
        user.set_password(PASSWORD)
        user.save(update_fields=["username", "password"])
        token, _ = Token.objects.get_or_create(user=user)
        membership = _ensure_org_membership(user)
        org = membership.organization
        if org.onboarding_completed != onboarding_completed:
            org.onboarding_completed = onboarding_completed
            org.save(update_fields=["onboarding_completed"])
        return user, token, membership

    def _cost_codes(self, user):
        """Return a dict of cost codes keyed by category for quote/CO/invoice line seeding.

        Sets taxable=True on material codes and taxable=False on labor codes.
        Returns: {"labor1": CostCode, "labor2": CostCode, "material1": CostCode, "material2": CostCode}
        """
        membership = _ensure_org_membership(user)
        org = membership.organization
        specs = [
            # (code, name, taxable) — labor codes are not taxed, material codes are
            ("06-100", "Rough Carpentry / Framing", False),       # labor1
            ("26-100", "Electrical Rough", False),                 # labor2
            ("09-300", "Flooring", True),                          # material1
            ("09-400", "Tile & Stone", True),                      # material2
        ]
        result = {}
        keys = ["labor1", "labor2", "material1", "material2"]
        for key, (code, name, taxable) in zip(keys, specs):
            cc, _ = CostCode.objects.get_or_create(
                organization=org, code=code,
                defaults={"name": name, "is_active": True, "taxable": taxable, "created_by": user},
            )
            if cc.taxable != taxable:
                cc.taxable = taxable
                cc.save(update_fields=["taxable", "updated_at"])
            result[key] = cc
        # Also ensure a few more codes have correct taxable flags
        for code, taxable in [
            ("22-100", False), ("22-200", True), ("23-100", False), ("23-200", True),
            ("09-100", False), ("09-200", False), ("06-200", False), ("06-300", True),
        ]:
            CostCode.objects.filter(organization=org, code=code).update(taxable=taxable)
        return result

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
        membership = _ensure_org_membership(user)
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
        membership = _ensure_org_membership(user)
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

    def _make_quote(self, user, project, title, version, status, subtotal, codes, **kwargs):
        """Create or update a quote with line items, sections, and markups.

        kwargs:
            sections: list of (name, line_specs) where line_specs is list of
                      (code_key, description, amount, unit, qty) tuples.
                      If omitted, generates two generic lines from subtotal.
            markups: dict with optional keys contingency_percent,
                     overhead_profit_percent, insurance_percent.
            billing_periods: list of (description, percent) tuples. Must sum to 100.
        """
        markups = kwargs.get("markups", {})
        cont_pct = Decimal(str(markups.get("contingency_percent", 0)))
        ohp_pct = Decimal(str(markups.get("overhead_profit_percent", 0)))
        ins_pct = Decimal(str(markups.get("insurance_percent", 0)))

        # Compute markup totals from subtotal
        cont_total = (subtotal * cont_pct / 100).quantize(Decimal("0.01"))
        ohp_total = (subtotal * ohp_pct / 100).quantize(Decimal("0.01"))
        ins_total = (subtotal * ins_pct / 100).quantize(Decimal("0.01"))
        markup_total = cont_total + ohp_total + ins_total
        grand_total = subtotal + markup_total  # tax applied on grand_total later if needed

        est, _ = Quote.objects.get_or_create(
            created_by=user, project=project, title=title, version=version,
            defaults={
                "status": status,
                "subtotal": subtotal,
                "markup_total": markup_total,
                "contingency_percent": cont_pct,
                "contingency_total": cont_total,
                "overhead_profit_percent": ohp_pct,
                "overhead_profit_total": ohp_total,
                "insurance_percent": ins_pct,
                "insurance_total": ins_total,
                "tax_percent": Decimal("0.00"),
                "tax_total": Decimal("0.00"),
                "grand_total": grand_total,
            },
        )
        est.status = status
        est.subtotal = subtotal
        est.markup_total = markup_total
        est.contingency_percent = cont_pct
        est.contingency_total = cont_total
        est.overhead_profit_percent = ohp_pct
        est.overhead_profit_total = ohp_total
        est.insurance_percent = ins_pct
        est.insurance_total = ins_total
        est.tax_percent = Decimal("0.00")
        est.tax_total = Decimal("0.00")
        est.grand_total = grand_total
        est.save(update_fields=[
            "status", "subtotal", "markup_total",
            "contingency_percent", "contingency_total",
            "overhead_profit_percent", "overhead_profit_total",
            "insurance_percent", "insurance_total",
            "tax_percent", "tax_total", "grand_total", "updated_at",
        ])
        self._sync_quote_lines(est, codes, subtotal, kwargs.get("sections"))
        self._sync_quote_status_history(est, status, user)
        self._sync_billing_periods(est, kwargs.get("billing_periods"))
        return est

    def _sync_quote_lines(self, quote, codes, subtotal, sections_spec):
        """Sync sections and line items for a quote.

        sections_spec: list of (section_name, [(code_key, desc, amount, unit, qty), ...])
                       If None, generates a flat two-line default.
        """
        QuoteSection.objects.filter(quote=quote).delete()
        QuoteLineItem.objects.filter(quote=quote).delete()

        if sections_spec is None:
            # Default: two lines, no sections
            subtotal = Decimal(subtotal).quantize(Decimal("0.01"))
            primary_total = (subtotal * Decimal("0.40")).quantize(Decimal("0.01"))
            secondary_total = subtotal - primary_total
            c1, c2 = codes["labor1"], codes["material1"]
            QuoteLineItem.objects.create(
                quote=quote, cost_code=c1, description=f"{quote.title} — {c1.name}",
                quantity=Decimal("1.00"), unit="ea", unit_price=primary_total,
                markup_percent=Decimal("0.00"), line_total=primary_total, order=0,
            )
            QuoteLineItem.objects.create(
                quote=quote, cost_code=c2, description=f"{quote.title} — {c2.name}",
                quantity=Decimal("1.00"), unit="ea", unit_price=secondary_total,
                markup_percent=Decimal("0.00"), line_total=secondary_total, order=1,
            )
            return

        order_counter = 0
        for section_name, line_specs in sections_spec:
            section_subtotal = Decimal("0.00")
            QuoteSection.objects.create(
                quote=quote, name=section_name, order=order_counter, subtotal=Decimal("0.00"),
            )
            section_order = order_counter
            order_counter += 1
            for code_key, desc, amount, unit, qty in line_specs:
                amount = Decimal(str(amount)).quantize(Decimal("0.01"))
                qty = Decimal(str(qty))
                unit_price = (amount / qty).quantize(Decimal("0.01")) if qty else amount
                QuoteLineItem.objects.create(
                    quote=quote, cost_code=codes[code_key], description=desc,
                    quantity=qty, unit=unit, unit_price=unit_price,
                    markup_percent=Decimal("0.00"), line_total=amount, order=order_counter,
                )
                section_subtotal += amount
                order_counter += 1
            # Update section subtotal
            QuoteSection.objects.filter(quote=quote, order=section_order).update(
                subtotal=section_subtotal,
            )

    def _sync_billing_periods(self, quote, periods_spec):
        """Sync billing periods for a quote. periods_spec: [(description, percent), ...]"""
        BillingPeriod.objects.filter(quote=quote).delete()
        if not periods_spec:
            return
        for i, (desc, pct) in enumerate(periods_spec):
            BillingPeriod.objects.create(
                quote=quote, description=desc,
                percent=Decimal(str(pct)), order=i,
            )

    def _sync_quote_status_history(self, quote, target_status, user):
        history = {
            Quote.Status.DRAFT: [
                (None, Quote.Status.DRAFT, "Quote created."),
            ],
            Quote.Status.SENT: [
                (None, Quote.Status.DRAFT, "Quote created."),
                (Quote.Status.DRAFT, Quote.Status.SENT, "Quote sent to customer."),
            ],
            Quote.Status.APPROVED: [
                (None, Quote.Status.DRAFT, "Quote created."),
                (Quote.Status.DRAFT, Quote.Status.SENT, "Quote sent to customer."),
                (Quote.Status.SENT, Quote.Status.APPROVED, "Quote approved by customer."),
            ],
            Quote.Status.REJECTED: [
                (None, Quote.Status.DRAFT, "Quote created."),
                (Quote.Status.DRAFT, Quote.Status.SENT, "Quote sent to customer."),
                (Quote.Status.SENT, Quote.Status.REJECTED, "Quote rejected by customer."),
            ],
            Quote.Status.ARCHIVED: [
                (None, Quote.Status.DRAFT, "Quote created."),
                (Quote.Status.DRAFT, Quote.Status.SENT, "Quote sent to customer."),
                (Quote.Status.SENT, Quote.Status.REJECTED, "Quote rejected by customer."),
                (Quote.Status.REJECTED, Quote.Status.ARCHIVED, "Rejected version archived."),
            ],
            Quote.Status.VOID: [
                (None, Quote.Status.DRAFT, "Quote created."),
                (Quote.Status.DRAFT, Quote.Status.VOID, "Quote voided."),
            ],
        }
        events = history.get(target_status, history[Quote.Status.DRAFT])
        QuoteStatusEvent.objects.filter(quote=quote).delete()
        for from_s, to_s, note in events:
            QuoteStatusEvent.objects.create(
                quote=quote, from_status=from_s, to_status=to_s,
                note=note, changed_by=user,
            )

    def _make_change_order(self, user, project, family_key, title, status, amount, codes, **kwargs):
        """Create or update a change order with line items, sections, and status history.

        kwargs:
            days_delta, reason, origin_quote,
            lines: list of (code_key, desc, amount_delta, days_delta, adjustment_reason)
            sections: list of (section_name, [(code_key, desc, amt, days, reason), ...])
        """
        origin_quote = kwargs.get("origin_quote") or Quote.objects.filter(
            project=project, status=Quote.Status.APPROVED,
        ).order_by("-version").first()
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
                "origin_quote": origin_quote,
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
        co.origin_quote = origin_quote
        co.save()

        # Sync lines — with optional sections
        self._sync_co_lines(co, codes, amount, kwargs)
        self._sync_co_status_history(co, status, user)
        return co

    def _sync_co_lines(self, co, codes, amount, kwargs):
        """Sync change order lines and optional sections."""
        ChangeOrderLine.objects.filter(change_order=co).delete()
        ChangeOrderSection.objects.filter(change_order=co).delete()

        sections_spec = kwargs.get("sections")
        if sections_spec:
            order_counter = 0
            for section_name, line_specs in sections_spec:
                section_subtotal = Decimal("0.00")
                ChangeOrderSection.objects.create(
                    change_order=co, name=section_name, order=order_counter, subtotal=Decimal("0.00"),
                )
                section_order = order_counter
                order_counter += 1
                for code_key, desc, amt, days, reason in line_specs:
                    amt = Decimal(str(amt))
                    ChangeOrderLine.objects.create(
                        change_order=co, cost_code=codes[code_key], description=desc,
                        amount_delta=amt, days_delta=days,
                        adjustment_reason=reason, order=order_counter,
                    )
                    section_subtotal += amt
                    order_counter += 1
                ChangeOrderSection.objects.filter(
                    change_order=co, order=section_order,
                ).update(subtotal=section_subtotal)
            return

        lines_spec = kwargs.get("lines")
        if lines_spec:
            for i, (code_key, desc, amt, days, reason) in enumerate(lines_spec):
                ChangeOrderLine.objects.create(
                    change_order=co, cost_code=codes[code_key], description=desc,
                    amount_delta=Decimal(str(amt)), days_delta=days,
                    adjustment_reason=reason, order=i,
                )
            return

        # Default: single line matching CO delta
        ChangeOrderLine.objects.create(
            change_order=co, cost_code=codes["labor1"], description=co.title,
            amount_delta=amount, days_delta=kwargs.get("days_delta", 0),
            adjustment_reason="Scope addition per owner request.", order=0,
        )

    def _sync_co_status_history(self, co, target_status, user):
        """Seed CO status event audit trail, symmetric with quote status history."""
        history = {
            ChangeOrder.Status.DRAFT: [
                (None, ChangeOrder.Status.DRAFT, "Change order created."),
            ],
            ChangeOrder.Status.SENT: [
                (None, ChangeOrder.Status.DRAFT, "Change order created."),
                (ChangeOrder.Status.DRAFT, ChangeOrder.Status.SENT, "Change order sent to customer."),
            ],
            ChangeOrder.Status.APPROVED: [
                (None, ChangeOrder.Status.DRAFT, "Change order created."),
                (ChangeOrder.Status.DRAFT, ChangeOrder.Status.SENT, "Change order sent to customer."),
                (ChangeOrder.Status.SENT, ChangeOrder.Status.APPROVED, "Change order approved by customer."),
            ],
            ChangeOrder.Status.REJECTED: [
                (None, ChangeOrder.Status.DRAFT, "Change order created."),
                (ChangeOrder.Status.DRAFT, ChangeOrder.Status.SENT, "Change order sent to customer."),
                (ChangeOrder.Status.SENT, ChangeOrder.Status.REJECTED, "Change order rejected by customer."),
            ],
            ChangeOrder.Status.VOID: [
                (None, ChangeOrder.Status.DRAFT, "Change order created."),
                (ChangeOrder.Status.DRAFT, ChangeOrder.Status.VOID, "Change order voided."),
            ],
        }
        events = history.get(target_status, history[ChangeOrder.Status.DRAFT])
        ChangeOrderStatusEvent.objects.filter(change_order=co).delete()
        for from_s, to_s, note in events:
            ChangeOrderStatusEvent.objects.create(
                change_order=co, from_status=from_s, to_status=to_s,
                note=note, changed_by=user,
            )

    def _make_invoice(self, user, project, customer, number, status, total, balance_due, **kwargs):
        today = date.today()
        related_quote = kwargs.get("related_quote")
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
                "related_quote": related_quote,
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
        inv.related_quote = related_quote
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
                "subtotal": total,
                "tax_total": Decimal("0.00"),
                "shipping_total": Decimal("0.00"),
                "total": total,
                "balance_due": balance_due,
                "notes": kwargs.get("notes", ""),
                "created_by": user,
            },
        )
        vb.status = status
        vb.issue_date = kwargs.get("issue_date", today)
        vb.due_date = kwargs.get("due_date", today + timedelta(days=21))
        vb.subtotal = total
        vb.tax_total = Decimal("0.00")
        vb.shipping_total = Decimal("0.00")
        vb.total = total
        vb.balance_due = balance_due
        vb.notes = kwargs.get("notes", "")
        vb.created_by = user
        vb.save()
        # Create a single vendor bill line
        VendorBillLine.objects.get_or_create(
            vendor_bill=vb,
            description=kwargs.get("notes", "") or f"Materials — {bill_number}",
            defaults={
                "quantity": Decimal("1.00"),
                "unit_price": total,
            },
        )
        return vb

    def _make_payment(self, user, project, direction, ref, method, status, amount, **kwargs):
        today = date.today()
        customer = project.customer if direction == Payment.Direction.INBOUND else None
        invoice = kwargs.get("invoice")
        vendor_bill = kwargs.get("vendor_bill")
        target_type = ""
        if invoice:
            target_type = Payment.TargetType.INVOICE
        elif vendor_bill:
            target_type = Payment.TargetType.VENDOR_BILL

        p, _ = Payment.objects.get_or_create(
            organization=project.organization, project=project,
            direction=direction, reference_number=ref,
            defaults={
                "customer": customer,
                "method": method,
                "status": status,
                "amount": amount,
                "payment_date": kwargs.get("payment_date", today),
                "notes": kwargs.get("notes", ""),
                "created_by": user,
                "target_type": target_type,
                "invoice": invoice,
                "vendor_bill": vendor_bill,
            },
        )
        p.method = method
        p.status = status
        p.amount = amount
        p.payment_date = kwargs.get("payment_date", today)
        p.notes = kwargs.get("notes", "")
        p.created_by = user
        p.target_type = target_type
        p.invoice = invoice
        p.vendor_bill = vendor_bill
        p.save()
        return p

    def _make_quick_expense(self, user, project, store_name, total, **kwargs):
        """Create a VendorBill for a quick expense (vendor auto-created by name)."""
        today = date.today()
        org = project.organization
        vendor = None
        if store_name:
            vendor, _ = Vendor.objects.get_or_create(
                organization=org, name__iexact=store_name,
                defaults={"name": store_name, "organization": org, "created_by": user},
            )
        balance_due = kwargs.get("balance_due", total)
        vb, _ = VendorBill.objects.get_or_create(
            project=project, vendor=vendor, total=total,
            defaults={
                "bill_number": "",
                "status": VendorBill.Status.OPEN,
                "issue_date": kwargs.get("issue_date", today),
                "balance_due": balance_due,
                "notes": kwargs.get("notes", ""),
                "created_by": user,
            },
        )
        vb.balance_due = balance_due
        vb.notes = kwargs.get("notes", "")
        vb._skip_transition_validation = True
        vb.save(update_fields=["balance_due", "notes", "updated_at"])
        return vb

    # ── Stage: New ───────────────────────────────────────────────────────

    def _seed_new(self):
        """Fresh signup. Org + cost codes bootstrapped, nothing else."""
        user, token, membership = self._get_or_create_user("new@test.com", onboarding_completed=False)
        self.stdout.write(self.style.SUCCESS("  new@test.com — empty workspace"))
        return user, token

    # ── Stage: Early ─────────────────────────────────────────────────────

    def _seed_early(self):
        """~2 months in. First customers, first projects, first quotes."""
        user, token, membership = self._get_or_create_user("early@test.com")
        codes = self._cost_codes(user)

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

        # 2 quotes: 1 draft (prospect), 1 sent (active)
        self._make_quote(user, p_prospect, "Kitchen Remodel Scope", 1,
            Quote.Status.DRAFT, Decimal("12000.00"), codes)
        self._make_quote(user, p_active, "Bathroom Renovation Scope", 1,
            Quote.Status.SENT, Decimal("8500.00"), codes)

        # 1 custom vendor
        Vendor.objects.get_or_create(
            created_by=user, name="Pacific Tile & Stone",
            defaults={
                "organization": membership.organization,
                "email": "orders@pacifictile.example",
            },
        )

        self.stdout.write(self.style.SUCCESS(
            "  early@test.com — 4 customers, 2 projects, 2 quotes, 1 vendor"
        ))
        return user, token

    # ── Stage: Mid ───────────────────────────────────────────────────────

    def _seed_mid(self):
        """~8 months in. One of each status for every entity type."""
        user, token, membership = self._get_or_create_user("mid@test.com")
        codes = self._cost_codes(user)

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

        # Quote family on active project (v1 archived → v2 rejected → v3 approved)
        # v1/v2: flat lines. v3 (approved): sectioned with markups + billing schedule.
        self._make_quote(user, p_active1, "Baker Office Scope", 1,
            Quote.Status.ARCHIVED, Decimal("22000.00"), codes)
        self._make_quote(user, p_active1, "Baker Office Scope", 2,
            Quote.Status.REJECTED, Decimal("23500.00"), codes)
        q_baker = self._make_quote(user, p_active1, "Baker Office Scope", 3,
            Quote.Status.APPROVED, Decimal("24000.00"), codes,
            sections=[
                ("Rough Work", [
                    ("labor1", "Framing — walls and ceiling grid", 6400, "sf", 800),
                    ("labor2", "Electrical rough-in — circuits and panels", 4800, "ea", 12),
                ]),
                ("Finishes", [
                    ("material1", "LVP flooring — main office area", 7200, "sf", 1200),
                    ("material2", "Tile — kitchenette backsplash and restroom", 5600, "sf", 140),
                ]),
            ],
            markups={"contingency_percent": 5, "overhead_profit_percent": 10},
            billing_periods=[
                ("Deposit", 10),
                ("Rough-in complete", 45),
                ("Final completion", 45),
            ])

        # More quotes in other statuses
        self._make_quote(user, p_prospect, "Anderson Bath Scope", 1,
            Quote.Status.DRAFT, Decimal("14000.00"), codes,
            sections=[
                ("Demo & Prep", [
                    ("labor1", "Selective demo — existing bath", 3200, "ls", 1),
                ]),
                ("Fixtures & Finishes", [
                    ("material2", "Tile — floor and shower walls", 5800, "sf", 120),
                    ("material1", "Vanity and fixtures", 5000, "ea", 1),
                ]),
            ])
        self._make_quote(user, p_active2, "Clark Kitchen Scope", 1,
            Quote.Status.SENT, Decimal("18000.00"), codes,
            markups={"overhead_profit_percent": 8},
            billing_periods=[
                ("Deposit", 10),
                ("Balance due on completion", 90),
            ])
        q_evans = self._make_quote(user, p_completed, "Evans Garage Scope", 1,
            Quote.Status.APPROVED, Decimal("32000.00"), codes,
            markups={"contingency_percent": 3, "overhead_profit_percent": 10, "insurance_percent": 2},
            billing_periods=[
                ("Deposit", 10),
                ("Framing complete", 35),
                ("Drywall & MEP", 35),
                ("Final walkthrough", 20),
            ])
        self._make_quote(user, p_cancelled, "Foster Basement Scope", 1,
            Quote.Status.VOID, Decimal("15000.00"), codes)
        self._make_quote(user, p_hold, "Davis Deck Scope", 1,
            Quote.Status.APPROVED, Decimal("9500.00"), codes,
            billing_periods=[
                ("Lump sum on completion", 100),
            ])

        # Change orders: draft, sent, approved, rejected, void
        self._make_change_order(user, p_active1, "1", "Add conference room outlets",
            ChangeOrder.Status.APPROVED, Decimal("2500.00"), codes, days_delta=2,
            lines=[
                ("labor2", "Run 4 dedicated 20A circuits to conference room", 1800, 1,
                 "Owner requested AV-ready outlets at all four walls."),
                ("material2", "Outlet covers and junction boxes", 700, 0,
                 "Commercial-grade spec per architect."),
            ])
        self._make_change_order(user, p_active1, "2", "Upgrade lighting fixtures",
            ChangeOrder.Status.DRAFT, Decimal("800.00"), codes,
            lines=[
                ("labor2", "Swap fluorescent troffers for recessed LED panels", 800, 0,
                 "Owner prefers warmer lighting — upgrade to 3000K LED."),
            ])
        self._make_change_order(user, p_active1, "3", "Add network drops",
            ChangeOrder.Status.SENT, Decimal("1200.00"), codes,
            lines=[
                ("labor2", "Pull Cat6a to 6 desk locations", 900, 1,
                 "IT requires hardwired connections for VoIP phones."),
                ("material1", "Patch panel and cable management", 300, 0,
                 "Materials for IDF closet buildout."),
            ])
        self._make_change_order(user, p_completed, "1", "Garage door upgrade",
            ChangeOrder.Status.APPROVED, Decimal("1200.00"), codes, days_delta=1,
            lines=[
                ("material1", "Insulated steel garage door — 16x7", 1200, 1,
                 "Owner upgraded from standard to insulated for workshop use."),
            ])
        self._make_change_order(user, p_completed, "2", "Cancel window relocation",
            ChangeOrder.Status.VOID, Decimal("600.00"), codes)

        # Invoices across statuses — link some to related_quote
        self._make_invoice(user, p_active1, mid_customers[1], "INV-001",
            Invoice.Status.DRAFT, Decimal("6000.00"), Decimal("6000.00"),
            cost_code=codes["labor1"], related_quote=q_baker)
        self._make_invoice(user, p_active1, mid_customers[1], "INV-002",
            Invoice.Status.SENT, Decimal("8000.00"), Decimal("8000.00"),
            cost_code=codes["material1"], related_quote=q_baker)
        self._make_invoice(user, p_active1, mid_customers[1], "INV-003",
            Invoice.Status.OUTSTANDING, Decimal("5000.00"), Decimal("2000.00"),
            cost_code=codes["labor1"])
        inv_paid = self._make_invoice(user, p_completed, mid_customers[4], "INV-004",
            Invoice.Status.CLOSED, Decimal("16000.00"), Decimal("0.00"),
            cost_code=codes["material1"], related_quote=q_evans)
        self._make_invoice(user, p_cancelled, mid_customers[5], "INV-005",
            Invoice.Status.VOID, Decimal("5000.00"), Decimal("0.00"),
            cost_code=codes["labor1"])

        # Custom vendors
        v_trade1, _ = Vendor.objects.get_or_create(
            created_by=user, name="Summit Electrical",
            defaults={"organization": membership.organization,
                       "email": "billing@summitelec.example"},
        )
        v_trade2, _ = Vendor.objects.get_or_create(
            created_by=user, name="Valley Plumbing Supply",
            defaults={"organization": membership.organization,
                       "email": "orders@valleyplumb.example"},
        )
        Vendor.objects.get_or_create(
            created_by=user, name="Metro Lumber Co",
            defaults={"organization": membership.organization,
                       "email": "sales@metrolumber.example"},
        )

        # Vendor bills across statuses
        self._make_vendor_bill(user, p_active1, v_trade1, "VB-001",
            VendorBill.Status.OPEN, Decimal("3200.00"), Decimal("3200.00"),
            notes="Electrical rough-in materials.")
        self._make_vendor_bill(user, p_active1, v_trade2, "VB-002",
            VendorBill.Status.CLOSED, Decimal("1800.00"), Decimal("0.00"),
            notes="Plumbing fixtures.")
        vb_closed = self._make_vendor_bill(user, p_completed, v_trade1, "VB-003",
            VendorBill.Status.CLOSED, Decimal("4500.00"), Decimal("0.00"),
            notes="Final electrical install.")
        self._make_vendor_bill(user, p_cancelled, v_trade2, "VB-004",
            VendorBill.Status.VOID, Decimal("2000.00"), Decimal("0.00"),
            notes="Cancelled with project.")
        self._make_vendor_bill(user, p_active1, v_trade1, "VB-005",
            VendorBill.Status.OPEN, Decimal("1500.00"), Decimal("1500.00"),
            notes="Upcoming material order.")
        self._make_vendor_bill(user, p_active1, v_trade2, "VB-006",
            VendorBill.Status.OPEN, Decimal("2200.00"), Decimal("2200.00"),
            notes="Plumbing bill under review.")

        # Payments — varied methods, some missing ref #s
        # Fully paid invoice: one payment covers it
        self._make_payment(user, p_completed, Payment.Direction.INBOUND,
            "AR-001", Payment.Method.ACH, Payment.Status.SETTLED, Decimal("16000.00"),
            invoice=inv_paid)
        # Fully paid vendor bill
        self._make_payment(user, p_completed, Payment.Direction.OUTBOUND,
            "AP-001", Payment.Method.CHECK, Payment.Status.SETTLED, Decimal("4500.00"),
            vendor_bill=vb_closed)
        # Partially paid invoice (INV-003): two payments, $3000 of $5000 covered
        inv_partial = Invoice.objects.filter(
            project=p_active1, invoice_number="INV-003").first()
        if inv_partial:
            self._make_payment(user, p_active1, Payment.Direction.INBOUND,
                "AR-003", Payment.Method.CHECK, Payment.Status.SETTLED, Decimal("2000.00"),
                invoice=inv_partial)
            self._make_payment(user, p_active1, Payment.Direction.INBOUND,
                "AR-004", Payment.Method.ZELLE, Payment.Status.SETTLED, Decimal("1000.00"),
                invoice=inv_partial)
        # Pending inbound (no target — deposit not yet matched)
        self._make_payment(user, p_active1, Payment.Direction.INBOUND,
            "AR-005", Payment.Method.CARD, Payment.Status.PENDING, Decimal("3000.00"))
        # Voided payment
        self._make_payment(user, p_active1, Payment.Direction.OUTBOUND,
            "AP-002", Payment.Method.ACH, Payment.Status.VOID, Decimal("1200.00"))
        # Payment against a bill — missing ref # (check with no ref)
        vb_closed_002 = VendorBill.objects.filter(
            project=p_active1, bill_number="VB-002").first()
        if vb_closed_002:
            self._make_payment(user, p_active1, Payment.Direction.OUTBOUND,
                "", Payment.Method.CHECK, Payment.Status.SETTLED, Decimal("1800.00"),
                vendor_bill=vb_closed_002)

        # Quick expenses + their payments
        e1 = self._make_quick_expense(user, p_active1, "Home Depot",
            Decimal("347.89"), balance_due=Decimal("0.00"),
            notes="Lumber and fasteners for framing")
        self._make_payment(user, p_active1, Payment.Direction.OUTBOUND,
            "HD-4821", Payment.Method.CARD, Payment.Status.SETTLED, Decimal("347.89"),
            vendor_bill=e1)
        e2 = self._make_quick_expense(user, p_active1, "Lowe's",
            Decimal("189.50"), balance_due=Decimal("0.00"),
            notes="Paint and supplies")
        self._make_payment(user, p_active1, Payment.Direction.OUTBOUND,
            "", Payment.Method.CASH, Payment.Status.SETTLED, Decimal("189.50"),
            vendor_bill=e2)
        # Unpaid expense
        self._make_quick_expense(user, p_active2, "Sherwin-Williams",
            Decimal("412.00"), balance_due=Decimal("412.00"),
            notes="Kitchen cabinet paint — pending reimbursement")

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
        codes = self._cost_codes(user)

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

        # Quotes for every project — active/completed get full families
        # Billing period patterns to rotate through on approved quotes
        bp_patterns = [
            [("Deposit", 10), ("Rough-in complete", 45), ("Final completion", 45)],
            [("Deposit", 10), ("Balance due on completion", 90)],
            [("Deposit", 10), ("Framing & rough", 35), ("Finishes & trim", 55)],
            [("Lump sum on completion", 100)],
        ]
        # Markup patterns to rotate through on approved quotes
        markup_patterns = [
            {"contingency_percent": 5, "overhead_profit_percent": 10},
            {"overhead_profit_percent": 8, "insurance_percent": 2},
            {"contingency_percent": 3, "overhead_profit_percent": 12, "insurance_percent": 2},
            {},  # no markups
        ]
        late_approved_quotes = {}  # p_idx → approved Quote for invoice linking
        bp_idx = 0
        for i, p in enumerate(late_projects):
            base_amount = Decimal(str(3000 + i * 2500))
            if p.status in {Project.Status.ACTIVE, Project.Status.COMPLETED}:
                # Full v1→v2→v3 family — v1/v2 flat, v3 has markups + billing periods
                self._make_quote(user, p, f"{p.name} Scope", 1,
                    Quote.Status.ARCHIVED, base_amount * Decimal("0.90"), codes)
                self._make_quote(user, p, f"{p.name} Scope", 2,
                    Quote.Status.REJECTED, base_amount * Decimal("0.95"), codes)
                q = self._make_quote(user, p, f"{p.name} Scope", 3,
                    Quote.Status.APPROVED, base_amount, codes,
                    markups=markup_patterns[bp_idx % len(markup_patterns)],
                    billing_periods=bp_patterns[bp_idx % len(bp_patterns)])
                late_approved_quotes[i] = q
                bp_idx += 1
            elif p.status == Project.Status.PROSPECT:
                self._make_quote(user, p, f"{p.name} Scope", 1,
                    Quote.Status.DRAFT, base_amount, codes)
            elif p.status == Project.Status.ON_HOLD:
                q = self._make_quote(user, p, f"{p.name} Scope", 1,
                    Quote.Status.APPROVED, base_amount, codes,
                    billing_periods=bp_patterns[bp_idx % len(bp_patterns)])
                late_approved_quotes[i] = q
                bp_idx += 1
            elif p.status == Project.Status.CANCELLED:
                self._make_quote(user, p, f"{p.name} Scope", 1,
                    Quote.Status.VOID, base_amount, codes)

        # Change orders on active + completed projects — with adjustment reasons
        co_specs = [
            (3, "1", "Upgrade master fixtures", ChangeOrder.Status.APPROVED, "7000", 3,
             [("material2", "Upgrade to porcelain fixtures", 4500, 2, "Owner selected premium line from showroom visit."),
              ("labor1", "Additional plumbing labor for fixture swap", 2500, 1, "New fixtures require modified supply lines.")]),
            (3, "2", "Add mudroom entry", ChangeOrder.Status.SENT, "3500", 0,
             [("labor1", "Frame and finish mudroom alcove", 2200, 2, "Owner wants drop zone by garage entry."),
              ("material1", "Tile flooring — mudroom", 1300, 0, "Durable tile for high-traffic entry.")]),
            (4, "1", "Conference room AV upgrade", ChangeOrder.Status.APPROVED, "7500", 2,
             [("labor2", "Run conduit and low-voltage for AV system", 4500, 1, "Tenant requires presentation-ready conference room."),
              ("material1", "AV mounting hardware and cable management", 3000, 0, "Commercial-grade AV infrastructure.")]),
            (4, "2", "Parking lot resurfacing", ChangeOrder.Status.DRAFT, "12000", 0,
             [("labor1", "Mill and overlay parking surface", 8000, 5, "Existing surface failing — landlord approved resurface."),
              ("material1", "Asphalt and striping materials", 4000, 0, "2-inch overlay with re-striping.")]),
            (7, "1", "Server room cooling", ChangeOrder.Status.APPROVED, "3200", 1,
             [("labor2", "Install dedicated mini-split for server closet", 3200, 1, "IT equipment requires independent climate control.")]),
            (10, "1", "Garage door opener upgrade", ChangeOrder.Status.APPROVED, "1200", 0,
             [("material1", "Belt-drive opener with smart controls", 1200, 0, "Owner upgraded from chain to belt drive for noise reduction.")]),
            (11, "1", "Pool house kitchenette", ChangeOrder.Status.APPROVED, "3400", 2,
             [("labor1", "Rough and finish kitchenette plumbing", 1800, 1, "Added wet bar per owner request."),
              ("material2", "Countertop and sink — kitchenette", 1600, 0, "Quartz counter with undermount sink.")]),
            (14, "1", "Kitchen hood upgrade", ChangeOrder.Status.APPROVED, "7000", 1,
             [("labor2", "Install commercial exhaust ductwork", 4000, 1, "Health dept requires Type I hood for new menu."),
              ("material1", "Stainless hood and make-up air unit", 3000, 0, "Commercial-rated equipment per code.")]),
            (14, "2", "Patio dining extension", ChangeOrder.Status.REJECTED, "15000", 0,
             [("labor1", "Concrete pad and pergola framing", 10000, 10, "Owner wanted outdoor seating — rejected due to permit timeline."),
              ("material1", "Pergola materials and concrete", 5000, 0, "Deferred to Phase 2.")]),
            (14, "3", "Walk-in cooler expansion", ChangeOrder.Status.VOID, "8000", 0,
             [("labor1", "Expand cooler footprint by 40sf", 5000, 3, "Voided — owner decided existing capacity sufficient."),
              ("material1", "Insulated panels and refrigeration piping", 3000, 0, "Materials order cancelled.")]),
            (16, "1", "Foundation change", ChangeOrder.Status.VOID, "6000", 0,
             [("labor1", "Switch from slab to crawlspace foundation", 6000, 5, "Voided with project cancellation.")]),
        ]
        for p_idx, fk, title, status, amt, days, lines in co_specs:
            self._make_change_order(user, late_projects[p_idx], fk, title, status,
                Decimal(amt), codes, days_delta=days, lines=lines)

        # Invoices — multiple per active/completed project
        # Link sent invoices to related_quote when one exists, leave drafts unlinked
        inv_num = 1
        # Active projects: draft + sent invoices
        for p_idx in [3, 4, 5, 6, 7]:
            p = late_projects[p_idx]
            c = late_customers[p_idx]
            rq = late_approved_quotes.get(p_idx)
            self._make_invoice(user, p, c, f"INV-{inv_num:03d}",
                Invoice.Status.SENT, Decimal("8000.00"), Decimal("8000.00"),
                cost_code=codes["labor1"], related_quote=rq)
            inv_num += 1
            self._make_invoice(user, p, c, f"INV-{inv_num:03d}",
                Invoice.Status.DRAFT, Decimal("6000.00"), Decimal("6000.00"),
                cost_code=codes["material1"])
            inv_num += 1

        # Completed projects: paid invoices — linked to quote
        paid_invoices = []
        for p_idx in [10, 11, 12, 13, 14, 15]:
            p = late_projects[p_idx]
            c = late_customers[p_idx]
            rq = late_approved_quotes.get(p_idx)
            inv = self._make_invoice(user, p, c, f"INV-{inv_num:03d}",
                Invoice.Status.CLOSED, Decimal("12000.00"), Decimal("0.00"),
                cost_code=codes["labor1"], related_quote=rq)
            paid_invoices.append(inv)
            inv_num += 1

        # One outstanding (partial payment) — linked
        self._make_invoice(user, late_projects[3], late_customers[3], f"INV-{inv_num:03d}",
            Invoice.Status.OUTSTANDING, Decimal("10000.00"), Decimal("4000.00"),
            cost_code=codes["material1"], related_quote=late_approved_quotes.get(3))
        inv_num += 1

        # One void — no quote link
        self._make_invoice(user, late_projects[16], late_customers[16], f"INV-{inv_num:03d}",
            Invoice.Status.VOID, Decimal("15000.00"), Decimal("0.00"),
            cost_code=codes["labor1"])

        # Custom vendors
        vendor_names = [
            ("Pinnacle Electric", "billing@pinnacle.example"),
            ("Riverside Plumbing", "ap@riverside.example"),
            ("Harbor HVAC Solutions", "invoices@harborhvac.example"),
            ("Crestview Lumber", "orders@crestview.example"),
            ("Summit Concrete", "billing@summitconcrete.example"),
            ("Ironclad Roofing Supply", "ap@ironclad.example"),
        ]
        late_vendors = []
        for vname, vemail in vendor_names:
            v, _ = Vendor.objects.get_or_create(
                created_by=user, name=vname,
                defaults={"organization": membership.organization, "email": vemail},
            )
            late_vendors.append(v)

        # Vendor bills across projects and statuses
        vb_num = 1
        vb_specs = [
            (3, 0, VendorBill.Status.OPEN, "4200.00", "4200.00"),
            (3, 1, VendorBill.Status.OPEN, "3800.00", "3800.00"),
            (4, 2, VendorBill.Status.OPEN, "6500.00", "6500.00"),
            (4, 3, VendorBill.Status.CLOSED, "8200.00", "0.00"),
            (5, 0, VendorBill.Status.OPEN, "2100.00", "2100.00"),
            (7, 1, VendorBill.Status.OPEN, "3500.00", "3500.00"),
            (10, 4, VendorBill.Status.CLOSED, "5000.00", "0.00"),
            (11, 5, VendorBill.Status.CLOSED, "7200.00", "0.00"),
            (14, 2, VendorBill.Status.CLOSED, "12000.00", "0.00"),
            (14, 3, VendorBill.Status.CLOSED, "8500.00", "0.00"),
            (16, 0, VendorBill.Status.VOID, "4000.00", "0.00"),
        ]
        paid_vendor_bills = []
        for p_idx, v_idx, status, total, balance in vb_specs:
            vb = self._make_vendor_bill(user, late_projects[p_idx], late_vendors[v_idx],
                f"VB-{vb_num:03d}", status, Decimal(total), Decimal(balance))
            if status == VendorBill.Status.CLOSED:
                paid_vendor_bills.append(vb)
            vb_num += 1

        # Payments — inbound for paid invoices, outbound for paid vendor bills
        # Rotate methods for variety
        inbound_methods = [
            Payment.Method.ACH, Payment.Method.CHECK, Payment.Method.ZELLE,
            Payment.Method.WIRE, Payment.Method.ACH, Payment.Method.CHECK,
        ]
        pay_num = 1
        for i, inv in enumerate(paid_invoices):
            method = inbound_methods[i % len(inbound_methods)]
            # Leave some check/ACH payments without ref # to trigger "No ref #" indicator
            ref = f"AR-{pay_num:03d}" if (i % 3 != 2) else ""
            self._make_payment(user, inv.project, Payment.Direction.INBOUND,
                ref, method, Payment.Status.SETTLED,
                inv.total, invoice=inv)
            pay_num += 1

        outbound_methods = [
            Payment.Method.CHECK, Payment.Method.ACH, Payment.Method.WIRE,
            Payment.Method.CHECK, Payment.Method.ACH,
        ]
        for i, vb in enumerate(paid_vendor_bills):
            method = outbound_methods[i % len(outbound_methods)]
            ref = f"AP-{pay_num:03d}" if (i % 4 != 3) else ""
            self._make_payment(user, vb.project, Payment.Direction.OUTBOUND,
                ref, method, Payment.Status.SETTLED,
                vb.total, vendor_bill=vb)
            pay_num += 1

        # Outstanding invoice — two payments covering $6000 of $10000
        inv_partial = Invoice.objects.filter(
            project=late_projects[3],
            status=Invoice.Status.OUTSTANDING,
        ).first()
        if inv_partial:
            self._make_payment(user, late_projects[3], Payment.Direction.INBOUND,
                f"AR-{pay_num:03d}", Payment.Method.CHECK, Payment.Status.SETTLED,
                Decimal("4000.00"), invoice=inv_partial)
            pay_num += 1
            self._make_payment(user, late_projects[3], Payment.Direction.INBOUND,
                f"AR-{pay_num:03d}", Payment.Method.ZELLE, Payment.Status.SETTLED,
                Decimal("2000.00"), invoice=inv_partial)
            pay_num += 1

        # Vendor bill with two payments (split across methods)
        vb_received = VendorBill.objects.filter(
            project=late_projects[5],
            status=VendorBill.Status.OPEN,
        ).first()
        if vb_received:
            half = (vb_received.total / 2).quantize(Decimal("0.01"))
            self._make_payment(user, late_projects[5], Payment.Direction.OUTBOUND,
                f"AP-{pay_num:03d}", Payment.Method.ACH, Payment.Status.SETTLED,
                half, vendor_bill=vb_received)
            pay_num += 1
            self._make_payment(user, late_projects[5], Payment.Direction.OUTBOUND,
                f"AP-{pay_num:03d}", Payment.Method.CHECK, Payment.Status.SETTLED,
                half, vendor_bill=vb_received)
            pay_num += 1

        # Voided payment
        self._make_payment(user, late_projects[7], Payment.Direction.OUTBOUND,
            f"AP-{pay_num:03d}", Payment.Method.ACH, Payment.Status.VOID,
            Decimal("1500.00"))
        pay_num += 1

        # Pending payments
        self._make_payment(user, late_projects[3], Payment.Direction.INBOUND,
            f"AR-{pay_num:03d}", Payment.Method.CARD, Payment.Status.PENDING,
            Decimal("6000.00"))
        pay_num += 1
        self._make_payment(user, late_projects[4], Payment.Direction.OUTBOUND,
            f"AP-{pay_num:03d}", Payment.Method.WIRE, Payment.Status.PENDING,
            Decimal("6500.00"))

        # Quick expenses — mix of paid and unpaid
        e1 = self._make_quick_expense(user, late_projects[1], "Home Depot",
            Decimal("523.47"), balance_due=Decimal("0.00"),
            notes="Framing lumber and hardware")
        self._make_payment(user, late_projects[1], Payment.Direction.OUTBOUND,
            "HD-9381", Payment.Method.CARD, Payment.Status.SETTLED,
            Decimal("523.47"), vendor_bill=e1)

        e2 = self._make_quick_expense(user, late_projects[3], "Lowe's",
            Decimal("891.20"), balance_due=Decimal("0.00"),
            notes="Bathroom fixtures and tile")
        self._make_payment(user, late_projects[3], Payment.Direction.OUTBOUND,
            "LW-2847", Payment.Method.CARD, Payment.Status.SETTLED,
            Decimal("891.20"), vendor_bill=e2)

        e3 = self._make_quick_expense(user, late_projects[7], "Sherwin-Williams",
            Decimal("267.50"), balance_due=Decimal("0.00"),
            notes="Interior paint — 8 gallons")
        self._make_payment(user, late_projects[7], Payment.Direction.OUTBOUND,
            "", Payment.Method.CASH, Payment.Status.SETTLED,
            Decimal("267.50"), vendor_bill=e3)

        e4 = self._make_quick_expense(user, late_projects[10], "Ferguson Supply",
            Decimal("1450.00"), balance_due=Decimal("0.00"),
            notes="HVAC ductwork and fittings")
        self._make_payment(user, late_projects[10], Payment.Direction.OUTBOUND,
            "FERG-5519", Payment.Method.ACH, Payment.Status.SETTLED,
            Decimal("1450.00"), vendor_bill=e4)

        # Unpaid expenses
        self._make_quick_expense(user, late_projects[5], "ABC Supply",
            Decimal("2100.00"), balance_due=Decimal("2100.00"),
            notes="Roofing materials — pending reimbursement")
        self._make_quick_expense(user, late_projects[14], "Grainger",
            Decimal("378.90"), balance_due=Decimal("378.90"),
            notes="Electrical tools and supplies")

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
