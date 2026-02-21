from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from rest_framework.authtoken.models import Token

from core.models import (
    AccountingSyncEvent,
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
    LeadContact,
    Payment,
    PaymentAllocation,
    Project,
    Vendor,
    VendorBill,
    VendorBillAllocation,
)
from core.views.helpers import _build_budget_baseline_snapshot

User = get_user_model()


class Command(BaseCommand):
    help = "Seed an idempotent Bob Bathroom Remodel MVP demo dataset."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            default="test@ex.com",
            help="Demo user email used for login.",
        )
        parser.add_argument(
            "--password",
            default="Qweqwe123",
            help="Demo user password.",
        )
        parser.add_argument(
            "--project-name",
            default="Bathroom Remodel (Demo)",
            help="Demo project name.",
        )

    def _audit_once(
        self,
        *,
        project,
        user,
        event_type,
        object_type,
        object_id,
        note,
        from_status="",
        to_status="",
        amount=None,
        metadata=None,
    ):
        exists = FinancialAuditEvent.objects.filter(
            project=project,
            created_by=user,
            event_type=event_type,
            object_type=object_type,
            object_id=object_id,
            note=note,
        ).exists()
        if exists:
            return
        FinancialAuditEvent.objects.create(
            project=project,
            created_by=user,
            event_type=event_type,
            object_type=object_type,
            object_id=object_id,
            from_status=from_status,
            to_status=to_status,
            amount=amount,
            note=note,
            metadata_json=metadata or {},
        )

    def _sync_estimate_lines(
        self,
        *,
        estimate,
        primary_cost_code,
        secondary_cost_code,
        subtotal: Decimal,
        primary_description: str,
        secondary_description: str,
    ):
        """Ensure deterministic seeded estimate lines that reconcile exactly to subtotal."""
        subtotal = Decimal(subtotal).quantize(Decimal("0.01"))
        primary_total = (subtotal * Decimal("0.40")).quantize(Decimal("0.01"))
        secondary_total = subtotal - primary_total
        line_specs = [
            (primary_cost_code, primary_description, primary_total),
            (secondary_cost_code, secondary_description, secondary_total),
        ]
        keep_ids = []

        for cost_code, description, line_total in line_specs:
            line, _ = EstimateLineItem.objects.get_or_create(
                estimate=estimate,
                cost_code=cost_code,
                description=description,
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
            line.save(
                update_fields=["quantity", "unit", "unit_cost", "markup_percent", "line_total", "updated_at"]
            )
            keep_ids.append(line.id)

        EstimateLineItem.objects.filter(estimate=estimate).exclude(id__in=keep_ids).delete()

    def _sync_vendor_bill_allocations(self, *, vendor_bill, allocations):
        """Ensure deterministic vendor-bill allocations and remove stale rows."""
        keep_ids = []

        for entry in allocations:
            existing_rows = VendorBillAllocation.objects.filter(
                vendor_bill=vendor_bill,
                budget_line=entry["budget_line"],
            ).order_by("id")
            row = existing_rows.first()
            if row is None:
                row = VendorBillAllocation.objects.create(
                    vendor_bill=vendor_bill,
                    budget_line=entry["budget_line"],
                    amount=entry["amount"],
                    note=entry.get("note", ""),
                )
            else:
                existing_rows.exclude(id=row.id).delete()
            row.amount = entry["amount"]
            row.note = entry.get("note", "")
            row.save(update_fields=["amount", "note"])
            keep_ids.append(row.id)

        VendorBillAllocation.objects.filter(vendor_bill=vendor_bill).exclude(id__in=keep_ids).delete()

    def _sync_estimate_status_history(
        self,
        *,
        estimate,
        target_status: str,
        changed_by,
        include_rework_cycle: bool = False,
    ):
        """Rebuild deterministic estimate status history ending at target status."""
        history_by_target = {
            Estimate.Status.DRAFT: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
            ],
            Estimate.Status.SENT: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to client."),
            ],
            Estimate.Status.APPROVED: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to client."),
                (Estimate.Status.SENT, Estimate.Status.APPROVED, "Estimate approved by client."),
            ],
            Estimate.Status.REJECTED: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to client."),
                (Estimate.Status.SENT, Estimate.Status.REJECTED, "Estimate rejected by client."),
            ],
            Estimate.Status.ARCHIVED: [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to client."),
                (Estimate.Status.SENT, Estimate.Status.REJECTED, "Estimate rejected by client."),
                (Estimate.Status.REJECTED, Estimate.Status.ARCHIVED, "Rejected version voided."),
            ],
        }

        events = history_by_target.get(target_status, history_by_target[Estimate.Status.DRAFT])
        if include_rework_cycle and target_status == Estimate.Status.APPROVED:
            events = [
                (None, Estimate.Status.DRAFT, "Estimate created."),
                (Estimate.Status.DRAFT, Estimate.Status.SENT, "Estimate sent to client."),
                (Estimate.Status.SENT, Estimate.Status.REJECTED, "Client rejected first submitted scope."),
                (Estimate.Status.REJECTED, Estimate.Status.ARCHIVED, "Rejected version voided after revision request."),
                (Estimate.Status.ARCHIVED, Estimate.Status.APPROVED, "Revised scope approved after rejection/void cycle."),
            ]

        EstimateStatusEvent.objects.filter(estimate=estimate).delete()
        for from_status, to_status, note in events:
            EstimateStatusEvent.objects.create(
                estimate=estimate,
                from_status=from_status,
                to_status=to_status,
                note=note,
                changed_by=changed_by,
            )

    @transaction.atomic
    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        password = options["password"]
        project_name = options["project_name"].strip()
        today = date.today()

        user, _ = User.objects.get_or_create(
            email=email,
            defaults={
                "username": email,
            },
        )
        if not user.username:
            user.username = email
        user.set_password(password)
        user.save(update_fields=["username", "password"])
        token, _ = Token.objects.get_or_create(user=user)

        customer, _ = Customer.objects.get_or_create(
            created_by=user,
            display_name="Bob Homeowner",
            defaults={
                "email": "bob@example.com",
                "phone": "555-0101",
                "billing_address": "101 Maple Ave",
            },
        )

        # Status coverage dataset: ensure one deterministic project row per lifecycle
        # state so each UI page can be previewed with realistic mixed populations.
        project_rows_by_status = {}
        for idx, (status, _) in enumerate(Project.Status.choices, start=1):
            scoped_name = f"{project_name} [{status}]"
            scoped_project, _ = Project.objects.get_or_create(
                created_by=user,
                customer=customer,
                name=scoped_name,
                defaults={
                    "status": status,
                    "contract_value_original": Decimal("1000.00") + Decimal(str(idx * 100)),
                    "contract_value_current": Decimal("1100.00") + Decimal(str(idx * 100)),
                    "start_date_planned": today + timedelta(days=idx),
                    "end_date_planned": today + timedelta(days=idx + 21),
                },
            )
            scoped_project.status = status
            scoped_project.contract_value_original = Decimal("1000.00") + Decimal(str(idx * 100))
            scoped_project.contract_value_current = Decimal("1100.00") + Decimal(str(idx * 100))
            if not scoped_project.start_date_planned:
                scoped_project.start_date_planned = today + timedelta(days=idx)
            if not scoped_project.end_date_planned:
                scoped_project.end_date_planned = today + timedelta(days=idx + 21)
            scoped_project.save(
                update_fields=[
                    "status",
                    "contract_value_original",
                    "contract_value_current",
                    "start_date_planned",
                    "end_date_planned",
                    "updated_at",
                ]
            )
            project_rows_by_status[status] = scoped_project

        child_models_project_name = f"{project_name} - CHILD MODELS (OPEN THIS PROJECT)"
        project, _ = Project.objects.get_or_create(
            created_by=user,
            customer=customer,
            name=child_models_project_name,
            defaults={
                "status": Project.Status.ACTIVE,
                "contract_value_original": Decimal("1000.00"),
                "contract_value_current": Decimal("1200.00"),
                "start_date_planned": today,
                "end_date_planned": today + timedelta(days=30),
            },
        )
        project.status = Project.Status.ACTIVE
        project.contract_value_original = Decimal("1000.00")
        project.contract_value_current = Decimal("1200.00")
        if not project.start_date_planned:
            project.start_date_planned = today
        if not project.end_date_planned:
            project.end_date_planned = today + timedelta(days=30)
        project.save(
            update_fields=[
                "status",
                "contract_value_original",
                "contract_value_current",
                "start_date_planned",
                "end_date_planned",
                "updated_at",
            ]
        )

        lead, _ = LeadContact.objects.get_or_create(
            created_by=user,
            phone="555-0101",
            project_address="101 Maple Ave",
            defaults={
                "full_name": "Bob Homeowner",
                "email": "bob@example.com",
                "notes": "Seeded demo intake lead.",
                "status": LeadContact.Status.PROJECT_CREATED,
                "converted_customer": customer,
                "converted_project": project,
                "converted_at": timezone.now(),
            },
        )
        if lead.status != LeadContact.Status.PROJECT_CREATED:
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

        code_demo, _ = CostCode.objects.get_or_create(
            created_by=user,
            code="10-100",
            defaults={"name": "Demo", "is_active": True},
        )
        code_tile, _ = CostCode.objects.get_or_create(
            created_by=user,
            code="20-200",
            defaults={"name": "Tile", "is_active": True},
        )

        child_models_estimate_title = "CHILD MODELS ESTIMATE (OPEN THIS ESTIMATE)"
        child_models_family_specs = [
            {"version": 1, "status": Estimate.Status.ARCHIVED, "subtotal": Decimal("900.00")},
            {"version": 2, "status": Estimate.Status.REJECTED, "subtotal": Decimal("950.00")},
            {"version": 3, "status": Estimate.Status.APPROVED, "subtotal": Decimal("1000.00")},
        ]
        child_models_family_rows: dict[int, Estimate] = {}
        for spec in child_models_family_specs:
            version = spec["version"]
            status = spec["status"]
            subtotal = spec["subtotal"]
            family_estimate, _ = Estimate.objects.get_or_create(
                created_by=user,
                project=project,
                title=child_models_estimate_title,
                version=version,
                defaults={
                    "status": status,
                    "subtotal": subtotal,
                    "markup_total": Decimal("0.00"),
                    "tax_percent": Decimal("0.00"),
                    "tax_total": Decimal("0.00"),
                    "grand_total": subtotal,
                },
            )
            family_estimate.status = status
            family_estimate.title = child_models_estimate_title
            family_estimate.subtotal = subtotal
            family_estimate.markup_total = Decimal("0.00")
            family_estimate.tax_percent = Decimal("0.00")
            family_estimate.tax_total = Decimal("0.00")
            family_estimate.grand_total = subtotal
            family_estimate.save(
                update_fields=[
                    "status",
                    "title",
                    "subtotal",
                    "markup_total",
                    "tax_percent",
                    "tax_total",
                    "grand_total",
                    "updated_at",
                ]
            )
            self._sync_estimate_lines(
                estimate=family_estimate,
                primary_cost_code=code_demo,
                secondary_cost_code=code_tile,
                subtotal=family_estimate.subtotal,
                primary_description=f"Family v{version} Demo",
                secondary_description=f"Family v{version} Tile",
            )
            self._sync_estimate_status_history(
                estimate=family_estimate,
                target_status=status,
                changed_by=user,
                include_rework_cycle=False,
            )
            child_models_family_rows[version] = family_estimate

        estimate = child_models_family_rows[3]

        budget, _ = Budget.objects.get_or_create(
            created_by=user,
            project=project,
            source_estimate=estimate,
            defaults={
                "status": Budget.Status.ACTIVE,
                "baseline_snapshot_json": _build_budget_baseline_snapshot(estimate),
                "approved_change_order_total": Decimal("200.00"),
            },
        )
        budget.status = Budget.Status.ACTIVE
        budget.baseline_snapshot_json = _build_budget_baseline_snapshot(estimate)
        budget.approved_change_order_total = Decimal("200.00")
        budget.save(
            update_fields=["status", "baseline_snapshot_json", "approved_change_order_total", "updated_at"]
        )

        budget_line_demo, _ = BudgetLine.objects.get_or_create(
            budget=budget,
            cost_code=code_demo,
            description="Demo",
            defaults={"budget_amount": Decimal("200.00")},
        )
        budget_line_demo.budget_amount = Decimal("200.00")
        budget_line_demo.committed_amount = Decimal("0.00")
        budget_line_demo.actual_amount = Decimal("0.00")
        budget_line_demo.save(
            update_fields=["budget_amount", "committed_amount", "actual_amount", "updated_at"]
        )
        budget_line_tile, _ = BudgetLine.objects.get_or_create(
            budget=budget,
            cost_code=code_tile,
            description="Tile",
            defaults={"budget_amount": Decimal("800.00")},
        )
        budget_line_tile.budget_amount = Decimal("800.00")
        budget_line_tile.committed_amount = Decimal("500.00")
        budget_line_tile.actual_amount = Decimal("500.00")
        budget_line_tile.save(
            update_fields=["budget_amount", "committed_amount", "actual_amount", "updated_at"]
        )

        change_order, _ = ChangeOrder.objects.get_or_create(
            project=project,
            number=1,
            defaults={
                "title": "Trim upgrade",
                "status": ChangeOrder.Status.APPROVED,
                "amount_delta": Decimal("200.00"),
                "days_delta": 1,
                "reason": "Owner requested upgraded trim.",
                "requested_by": user,
                "approved_by": user,
                "approved_at": timezone.now(),
            },
        )
        change_order.title = "Trim upgrade"
        change_order.status = ChangeOrder.Status.APPROVED
        change_order.amount_delta = Decimal("200.00")
        change_order.days_delta = 1
        change_order.reason = "Owner requested upgraded trim."
        change_order.requested_by = user
        change_order.approved_by = user
        if not change_order.approved_at:
            change_order.approved_at = timezone.now()
        change_order.save(
            update_fields=[
                "title",
                "status",
                "amount_delta",
                "days_delta",
                "reason",
                "requested_by",
                "approved_by",
                "approved_at",
                "updated_at",
            ]
        )

        invoice, _ = Invoice.objects.get_or_create(
            project=project,
            invoice_number="INV-0001",
            defaults={
                "customer": customer,
                "status": Invoice.Status.PAID,
                "issue_date": today,
                "due_date": today + timedelta(days=30),
                "subtotal": Decimal("1200.00"),
                "tax_percent": Decimal("0.00"),
                "tax_total": Decimal("0.00"),
                "total": Decimal("1200.00"),
                "balance_due": Decimal("0.00"),
                "created_by": user,
            },
        )
        invoice.customer = customer
        invoice.status = Invoice.Status.PAID
        invoice.issue_date = today
        invoice.due_date = today + timedelta(days=30)
        invoice.subtotal = Decimal("1200.00")
        invoice.tax_percent = Decimal("0.00")
        invoice.tax_total = Decimal("0.00")
        invoice.total = Decimal("1200.00")
        invoice.balance_due = Decimal("0.00")
        invoice.created_by = user
        invoice.save(
            update_fields=[
                "customer",
                "status",
                "issue_date",
                "due_date",
                "subtotal",
                "tax_percent",
                "tax_total",
                "total",
                "balance_due",
                "created_by",
                "updated_at",
            ]
        )
        inv_line, _ = InvoiceLine.objects.get_or_create(
            invoice=invoice,
            description="Bathroom Remodel Draw",
            defaults={
                "cost_code": code_tile,
                "quantity": Decimal("1.00"),
                "unit": "ea",
                "unit_price": Decimal("1200.00"),
                "line_total": Decimal("1200.00"),
            },
        )
        inv_line.cost_code = code_tile
        inv_line.quantity = Decimal("1.00")
        inv_line.unit = "ea"
        inv_line.unit_price = Decimal("1200.00")
        inv_line.line_total = Decimal("1200.00")
        inv_line.save(update_fields=["cost_code", "quantity", "unit", "unit_price", "line_total", "updated_at"])

        vendor, _ = Vendor.objects.get_or_create(
            created_by=user,
            name="Tile Vendor Co",
            defaults={
                "email": "ap@tilevendor.example",
                "vendor_type": Vendor.VendorType.TRADE,
                "is_canonical": False,
            },
        )
        vendor.vendor_type = Vendor.VendorType.TRADE
        vendor.is_canonical = False
        vendor.save(update_fields=["vendor_type", "is_canonical", "updated_at"])

        canonical_retail_vendors = [
            "Home Depot",
            "Lowe's",
            "Menards",
            "Amazon Business",
            "Sherwin-Williams",
            "Floor & Decor",
            "Ferguson",
            "Ace Hardware",
        ]
        for canonical_name in canonical_retail_vendors:
            canonical_vendor, _ = Vendor.objects.get_or_create(
                created_by=user,
                name=canonical_name,
                defaults={
                    "vendor_type": Vendor.VendorType.RETAIL,
                    "is_canonical": True,
                    "is_active": True,
                },
            )
            canonical_vendor.vendor_type = Vendor.VendorType.RETAIL
            canonical_vendor.is_canonical = True
            canonical_vendor.is_active = True
            canonical_vendor.save(
                update_fields=["vendor_type", "is_canonical", "is_active", "updated_at"]
            )

        vendor_bill, _ = VendorBill.objects.get_or_create(
            project=project,
            vendor=vendor,
            bill_number="VB-100",
            defaults={
                "status": VendorBill.Status.PAID,
                "issue_date": today,
                "due_date": today + timedelta(days=30),
                "total": Decimal("500.00"),
                "balance_due": Decimal("0.00"),
                "notes": "Tile material supplier bill.",
                "created_by": user,
            },
        )
        vendor_bill.status = VendorBill.Status.PAID
        vendor_bill.issue_date = today
        vendor_bill.due_date = today + timedelta(days=30)
        vendor_bill.total = Decimal("500.00")
        vendor_bill.balance_due = Decimal("0.00")
        vendor_bill.notes = "Tile material supplier bill."
        vendor_bill.created_by = user
        vendor_bill.save(
            update_fields=["status", "issue_date", "due_date", "total", "balance_due", "notes", "created_by", "updated_at"]
        )
        self._sync_vendor_bill_allocations(
            vendor_bill=vendor_bill,
            allocations=[
                {
                    "budget_line": budget_line_tile,
                    "amount": Decimal("500.00"),
                    "note": "Seed paid bill allocation.",
                }
            ],
        )

        inbound_payment, _ = Payment.objects.get_or_create(
            project=project,
            direction=Payment.Direction.INBOUND,
            reference_number="AR-1",
            defaults={
                "method": Payment.Method.ACH,
                "status": Payment.Status.SETTLED,
                "amount": Decimal("1200.00"),
                "payment_date": today,
                "notes": "Customer payment applied in full.",
                "created_by": user,
            },
        )
        inbound_payment.method = Payment.Method.ACH
        inbound_payment.status = Payment.Status.SETTLED
        inbound_payment.amount = Decimal("1200.00")
        inbound_payment.payment_date = today
        inbound_payment.notes = "Customer payment applied in full."
        inbound_payment.created_by = user
        inbound_payment.save(
            update_fields=["method", "status", "amount", "payment_date", "notes", "created_by", "updated_at"]
        )

        outbound_payment, _ = Payment.objects.get_or_create(
            project=project,
            direction=Payment.Direction.OUTBOUND,
            reference_number="AP-1",
            defaults={
                "method": Payment.Method.CHECK,
                "status": Payment.Status.SETTLED,
                "amount": Decimal("500.00"),
                "payment_date": today,
                "notes": "Vendor payment applied in full.",
                "created_by": user,
            },
        )
        outbound_payment.method = Payment.Method.CHECK
        outbound_payment.status = Payment.Status.SETTLED
        outbound_payment.amount = Decimal("500.00")
        outbound_payment.payment_date = today
        outbound_payment.notes = "Vendor payment applied in full."
        outbound_payment.created_by = user
        outbound_payment.save(
            update_fields=["method", "status", "amount", "payment_date", "notes", "created_by", "updated_at"]
        )

        PaymentAllocation.objects.get_or_create(
            payment=inbound_payment,
            target_type=PaymentAllocation.TargetType.INVOICE,
            invoice=invoice,
            vendor_bill=None,
            defaults={"applied_amount": Decimal("1200.00"), "created_by": user},
        )
        PaymentAllocation.objects.get_or_create(
            payment=outbound_payment,
            target_type=PaymentAllocation.TargetType.VENDOR_BILL,
            invoice=None,
            vendor_bill=vendor_bill,
            defaults={"applied_amount": Decimal("500.00"), "created_by": user},
        )

        AccountingSyncEvent.objects.get_or_create(
            project=project,
            created_by=user,
            provider=AccountingSyncEvent.Provider.QUICKBOOKS_ONLINE,
            object_type="invoice",
            object_id=invoice.id,
            direction=AccountingSyncEvent.Direction.PUSH,
            status=AccountingSyncEvent.Status.FAILED,
            defaults={
                "external_id": "",
                "error_message": "Demo sync failed. Use retry flow in UI.",
                "retry_count": 0,
                "last_attempt_at": timezone.now(),
            },
        )

        for idx, (status, _) in enumerate(LeadContact.Status.choices, start=1):
            lead_phone = f"555-22{idx:02d}"
            scoped_lead, _ = LeadContact.objects.get_or_create(
                created_by=user,
                phone=lead_phone,
                project_address=f"{100 + idx} Seed Status Ave",
                defaults={
                    "full_name": f"Seed Lead {status.title().replace('_', ' ')}",
                    "email": f"lead-{status}@example.com",
                    "status": status,
                    "source": LeadContact.Source.FIELD_MANUAL,
                    "notes": f"Seeded lead in status {status}.",
                },
            )
            scoped_lead.full_name = f"Seed Lead {status.title().replace('_', ' ')}"
            scoped_lead.email = f"lead-{status}@example.com"
            scoped_lead.status = status
            scoped_lead.source = LeadContact.Source.FIELD_MANUAL
            scoped_lead.notes = f"Seeded lead in status {status}."
            if status == LeadContact.Status.PROJECT_CREATED:
                scoped_lead.converted_customer = customer
                scoped_lead.converted_project = project
                scoped_lead.converted_at = timezone.now()
            else:
                scoped_lead.converted_customer = None
                scoped_lead.converted_project = None
                scoped_lead.converted_at = None
            scoped_lead.save(
                update_fields=[
                    "full_name",
                    "email",
                    "status",
                    "source",
                    "notes",
                    "converted_customer",
                    "converted_project",
                    "converted_at",
                    "updated_at",
                ]
            )

        estimate_rows_by_status = {}
        for idx, (status, _) in enumerate(Estimate.Status.choices, start=1):
            coverage_title = f"STATUS VARIATION ESTIMATE ({status.upper()})"
            scoped_estimate, _ = Estimate.objects.get_or_create(
                created_by=user,
                project=project,
                title=coverage_title,
                version=1,
                defaults={
                    "status": status,
                    "subtotal": Decimal("500.00") + Decimal(str(idx * 50)),
                    "markup_total": Decimal("0.00"),
                    "tax_percent": Decimal("0.00"),
                    "tax_total": Decimal("0.00"),
                    "grand_total": Decimal("500.00") + Decimal(str(idx * 50)),
                },
            )
            # Keep exactly one deterministic status-coverage estimate per status.
            Estimate.objects.filter(
                created_by=user,
                project=project,
                title=coverage_title,
            ).exclude(id=scoped_estimate.id).delete()
            scoped_estimate.status = status
            scoped_estimate.subtotal = Decimal("500.00") + Decimal(str(idx * 50))
            scoped_estimate.markup_total = Decimal("0.00")
            scoped_estimate.tax_percent = Decimal("0.00")
            scoped_estimate.tax_total = Decimal("0.00")
            scoped_estimate.grand_total = Decimal("500.00") + Decimal(str(idx * 50))
            scoped_estimate.save(
                update_fields=[
                    "status",
                    "subtotal",
                    "markup_total",
                    "tax_percent",
                    "tax_total",
                    "grand_total",
                    "updated_at",
                ]
            )
            self._sync_estimate_lines(
                estimate=scoped_estimate,
                primary_cost_code=code_demo,
                secondary_cost_code=code_tile,
                subtotal=scoped_estimate.subtotal,
                primary_description=f"Status {status} Demo",
                secondary_description=f"Status {status} Tile",
            )
            estimate_rows_by_status[status] = scoped_estimate

        for status, scoped_estimate in estimate_rows_by_status.items():
            self._sync_estimate_status_history(
                estimate=scoped_estimate,
                target_status=status,
                changed_by=user,
                include_rework_cycle=False,
            )

        budget_source_estimate = estimate_rows_by_status.get(Estimate.Status.APPROVED, estimate)
        # Budget status is currently internal system state, not user-facing lifecycle.
        # Seed only one deterministic active baseline record for analytics previews.
        scoped_budget, _ = Budget.objects.get_or_create(
            created_by=user,
            project=project,
            source_estimate=budget_source_estimate,
            defaults={
                "status": Budget.Status.ACTIVE,
                "baseline_snapshot_json": _build_budget_baseline_snapshot(budget_source_estimate),
                "approved_change_order_total": Decimal("25.00"),
            },
        )
        scoped_budget.status = Budget.Status.ACTIVE
        scoped_budget.baseline_snapshot_json = _build_budget_baseline_snapshot(budget_source_estimate)
        scoped_budget.approved_change_order_total = Decimal("25.00")
        scoped_budget.save(
            update_fields=["status", "baseline_snapshot_json", "approved_change_order_total", "updated_at"]
        )

        for idx, (status, _) in enumerate(ChangeOrder.Status.choices, start=1):
            scoped_change_order, _ = ChangeOrder.objects.get_or_create(
                project=project,
                number=100 + idx,
                defaults={
                    "title": f"Status Coverage CO ({status})",
                    "status": status,
                    "amount_delta": Decimal(str(idx * 10)),
                    "days_delta": idx,
                    "reason": f"Seeded change order in status {status}.",
                    "requested_by": user,
                },
            )
            scoped_change_order.title = f"Status Coverage CO ({status})"
            scoped_change_order.status = status
            scoped_change_order.amount_delta = Decimal(str(idx * 10))
            scoped_change_order.days_delta = idx
            scoped_change_order.reason = f"Seeded change order in status {status}."
            scoped_change_order.requested_by = user
            if status == ChangeOrder.Status.APPROVED:
                scoped_change_order.approved_by = user
                scoped_change_order.approved_at = timezone.now()
            else:
                scoped_change_order.approved_by = None
                scoped_change_order.approved_at = None
            scoped_change_order.save(
                update_fields=[
                    "title",
                    "status",
                    "amount_delta",
                    "days_delta",
                    "reason",
                    "requested_by",
                    "approved_by",
                    "approved_at",
                    "updated_at",
                ]
            )

        for idx, (status, _) in enumerate(Invoice.Status.choices, start=1):
            invoice_number = f"INV-STATUS-{idx:02d}"
            scoped_invoice, _ = Invoice.objects.get_or_create(
                project=project,
                invoice_number=invoice_number,
                defaults={
                    "customer": customer,
                    "status": status,
                    "issue_date": today + timedelta(days=idx),
                    "due_date": today + timedelta(days=idx + 30),
                    "subtotal": Decimal("300.00"),
                    "tax_percent": Decimal("0.00"),
                    "tax_total": Decimal("0.00"),
                    "total": Decimal("300.00"),
                    "balance_due": Decimal("300.00"),
                    "created_by": user,
                },
            )
            scoped_invoice.customer = customer
            scoped_invoice.status = status
            scoped_invoice.issue_date = today + timedelta(days=idx)
            scoped_invoice.due_date = today + timedelta(days=idx + 30)
            scoped_invoice.subtotal = Decimal("300.00")
            scoped_invoice.tax_percent = Decimal("0.00")
            scoped_invoice.tax_total = Decimal("0.00")
            scoped_invoice.total = Decimal("300.00")
            if status in {Invoice.Status.PAID, Invoice.Status.VOID}:
                scoped_invoice.balance_due = Decimal("0.00")
            elif status == Invoice.Status.PARTIALLY_PAID:
                scoped_invoice.balance_due = Decimal("120.00")
            else:
                scoped_invoice.balance_due = Decimal("300.00")
            scoped_invoice.created_by = user
            scoped_invoice.save(
                update_fields=[
                    "customer",
                    "status",
                    "issue_date",
                    "due_date",
                    "subtotal",
                    "tax_percent",
                    "tax_total",
                    "total",
                    "balance_due",
                    "created_by",
                    "updated_at",
                ]
            )

        for idx, (status, _) in enumerate(VendorBill.Status.choices, start=1):
            bill_number = f"VB-STATUS-{idx:02d}"
            scoped_vendor_bill, _ = VendorBill.objects.get_or_create(
                project=project,
                vendor=vendor,
                bill_number=bill_number,
                defaults={
                    "status": status,
                    "issue_date": today + timedelta(days=idx),
                    "due_date": today + timedelta(days=idx + 21),
                    "scheduled_for": today + timedelta(days=idx + 10),
                    "total": Decimal("180.00"),
                    "balance_due": Decimal("180.00"),
                    "notes": f"Seeded vendor bill in status {status}.",
                    "created_by": user,
                },
            )
            scoped_vendor_bill.status = status
            scoped_vendor_bill.issue_date = today + timedelta(days=idx)
            scoped_vendor_bill.due_date = today + timedelta(days=idx + 21)
            scoped_vendor_bill.scheduled_for = (
                today + timedelta(days=idx + 10)
                if status in {VendorBill.Status.SCHEDULED, VendorBill.Status.PAID}
                else None
            )
            scoped_vendor_bill.total = Decimal("180.00")
            scoped_vendor_bill.balance_due = (
                Decimal("0.00") if status in {VendorBill.Status.PAID, VendorBill.Status.VOID} else Decimal("180.00")
            )
            scoped_vendor_bill.notes = f"Seeded vendor bill in status {status}."
            scoped_vendor_bill.created_by = user
            scoped_vendor_bill.save(
                update_fields=[
                    "status",
                    "issue_date",
                    "due_date",
                    "scheduled_for",
                    "total",
                    "balance_due",
                    "notes",
                    "created_by",
                    "updated_at",
                ]
            )
            if status in {VendorBill.Status.APPROVED, VendorBill.Status.SCHEDULED, VendorBill.Status.PAID}:
                self._sync_vendor_bill_allocations(
                    vendor_bill=scoped_vendor_bill,
                    allocations=[
                        {
                            "budget_line": budget_line_demo,
                            "amount": Decimal("90.00"),
                            "note": "Seed status coverage allocation (demo).",
                        },
                        {
                            "budget_line": budget_line_tile,
                            "amount": Decimal("90.00"),
                            "note": "Seed status coverage allocation (tile).",
                        },
                    ],
                )
            else:
                self._sync_vendor_bill_allocations(vendor_bill=scoped_vendor_bill, allocations=[])

        payment_methods = [method for method, _ in Payment.Method.choices]
        for direction, _ in Payment.Direction.choices:
            direction_prefix = "AR" if direction == Payment.Direction.INBOUND else "AP"
            for idx, (status, _) in enumerate(Payment.Status.choices, start=1):
                reference_number = f"{direction_prefix}-STATUS-{idx:02d}"
                scoped_payment, _ = Payment.objects.get_or_create(
                    project=project,
                    direction=direction,
                    reference_number=reference_number,
                    defaults={
                        "method": payment_methods[(idx - 1) % len(payment_methods)],
                        "status": status,
                        "amount": Decimal("150.00"),
                        "payment_date": today + timedelta(days=idx),
                        "notes": f"Seeded payment in status {status}.",
                        "created_by": user,
                    },
                )
                scoped_payment.method = payment_methods[(idx - 1) % len(payment_methods)]
                scoped_payment.status = status
                scoped_payment.amount = Decimal("150.00")
                scoped_payment.payment_date = today + timedelta(days=idx)
                scoped_payment.notes = f"Seeded payment in status {status}."
                scoped_payment.created_by = user
                scoped_payment.save(
                    update_fields=[
                        "method",
                        "status",
                        "amount",
                        "payment_date",
                        "notes",
                        "created_by",
                        "updated_at",
                    ]
                )

        sync_directions = [direction for direction, _ in AccountingSyncEvent.Direction.choices]
        for idx, (status, _) in enumerate(AccountingSyncEvent.Status.choices, start=1):
            scoped_sync_event, _ = AccountingSyncEvent.objects.get_or_create(
                project=project,
                created_by=user,
                provider=AccountingSyncEvent.Provider.QUICKBOOKS_ONLINE,
                object_type=f"status_coverage_{status}",
                object_id=idx,
                direction=sync_directions[(idx - 1) % len(sync_directions)],
                defaults={
                    "status": status,
                    "external_id": f"SYNC-{idx:02d}" if status == AccountingSyncEvent.Status.SUCCESS else "",
                    "error_message": (
                        "Seeded failed sync status coverage."
                        if status == AccountingSyncEvent.Status.FAILED
                        else ""
                    ),
                    "retry_count": 1 if status == AccountingSyncEvent.Status.FAILED else 0,
                    "last_attempt_at": timezone.now(),
                },
            )
            scoped_sync_event.status = status
            scoped_sync_event.direction = sync_directions[(idx - 1) % len(sync_directions)]
            scoped_sync_event.external_id = (
                f"SYNC-{idx:02d}" if status == AccountingSyncEvent.Status.SUCCESS else ""
            )
            scoped_sync_event.error_message = (
                "Seeded failed sync status coverage."
                if status == AccountingSyncEvent.Status.FAILED
                else ""
            )
            scoped_sync_event.retry_count = 1 if status == AccountingSyncEvent.Status.FAILED else 0
            scoped_sync_event.last_attempt_at = timezone.now()
            scoped_sync_event.save(
                update_fields=[
                    "status",
                    "direction",
                    "external_id",
                    "error_message",
                    "retry_count",
                    "last_attempt_at",
                    "updated_at",
                ]
            )

        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.ESTIMATE_STATUS_CHANGED,
            object_type="estimate",
            object_id=estimate.id,
            from_status="",
            to_status=Estimate.Status.DRAFT,
            amount=estimate.grand_total,
            note="Estimate created.",
            metadata={"version": estimate.version},
        )
        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.ESTIMATE_STATUS_CHANGED,
            object_type="estimate",
            object_id=estimate.id,
            from_status=Estimate.Status.DRAFT,
            to_status=Estimate.Status.APPROVED,
            amount=estimate.grand_total,
            note="Approved by homeowner.",
            metadata={"version": estimate.version},
        )
        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.BUDGET_CONVERTED,
            object_type="budget",
            object_id=budget.id,
            to_status=Budget.Status.ACTIVE,
            amount=Decimal("1000.00"),
            note=f"Budget converted from estimate #{estimate.id}.",
            metadata={"estimate_id": estimate.id},
        )
        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.CHANGE_ORDER_UPDATED,
            object_type="change_order",
            object_id=change_order.id,
            from_status=ChangeOrder.Status.PENDING_APPROVAL,
            to_status=ChangeOrder.Status.APPROVED,
            amount=change_order.amount_delta,
            note="Change order approved.",
            metadata={"number": change_order.number},
        )
        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.INVOICE_UPDATED,
            object_type="invoice",
            object_id=invoice.id,
            from_status=Invoice.Status.SENT,
            to_status=Invoice.Status.PAID,
            amount=invoice.total,
            note="Invoice paid in full.",
            metadata={"invoice_number": invoice.invoice_number},
        )
        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.VENDOR_BILL_UPDATED,
            object_type="vendor_bill",
            object_id=vendor_bill.id,
            from_status=VendorBill.Status.SCHEDULED,
            to_status=VendorBill.Status.PAID,
            amount=vendor_bill.total,
            note="Vendor bill paid in full.",
            metadata={"bill_number": vendor_bill.bill_number},
        )
        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.PAYMENT_UPDATED,
            object_type="payment",
            object_id=inbound_payment.id,
            to_status=Payment.Status.SETTLED,
            amount=inbound_payment.amount,
            note="Inbound payment settled.",
            metadata={"direction": inbound_payment.direction},
        )
        self._audit_once(
            project=project,
            user=user,
            event_type=FinancialAuditEvent.EventType.PAYMENT_ALLOCATED,
            object_type="payment_allocation",
            object_id=inbound_payment.id,
            from_status=Payment.Status.SETTLED,
            to_status=Payment.Status.SETTLED,
            amount=Decimal("1200.00"),
            note=f"Payment allocated to invoice #{invoice.id}.",
            metadata={"target_type": "invoice", "target_id": invoice.id},
        )

        self.stdout.write(self.style.SUCCESS("Seeded Bob bathroom remodel demo dataset."))
        self.stdout.write(f"Email: {email}")
        self.stdout.write(f"Password: {password}")
        self.stdout.write(f"Token: {token.key}")
        self.stdout.write("Status-only projects (for project lifecycle preview):")
        for status, _ in Project.Status.choices:
            scoped_name = f"{project_name} [{status}]"
            scoped_id = project_rows_by_status[status].id
            self.stdout.write(f"- {scoped_name} (id={scoped_id})")
        self.stdout.write(f"Child Models Project Name: {child_models_project_name}")
        self.stdout.write(f"Child Models Estimate Title: {child_models_estimate_title}")
        self.stdout.write("Child Models Estimate Family Versions: v1 archived, v2 rejected, v3 approved")
        self.stdout.write(f"Project ID: {project.id}")
        self.stdout.write("Manual flow entry points:")
        self.stdout.write("- /intake/quick-add")
        self.stdout.write("- /projects")
        self.stdout.write(f"- /projects/{project.id}/estimates")
        self.stdout.write(f"- /projects/{project.id}/budgets/analytics")
        self.stdout.write("- /change-orders")
        self.stdout.write("- /invoices")
        self.stdout.write(f"- /projects/{project.id}/vendor-bills")
        self.stdout.write(f"- /projects/{project.id}/expenses")
        self.stdout.write("- /payments")
        self.stdout.write("Status coverage rows seeded for lifecycle previews.")
