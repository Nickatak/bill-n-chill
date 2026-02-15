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

        project, _ = Project.objects.get_or_create(
            created_by=user,
            customer=customer,
            name=project_name,
            defaults={
                "status": Project.Status.ACTIVE,
                "contract_value_original": Decimal("1000.00"),
                "contract_value_current": Decimal("1200.00"),
                "start_date_planned": today,
                "end_date_planned": today + timedelta(days=21),
            },
        )
        project.status = Project.Status.ACTIVE
        project.contract_value_original = Decimal("1000.00")
        project.contract_value_current = Decimal("1200.00")
        if not project.start_date_planned:
            project.start_date_planned = today
        if not project.end_date_planned:
            project.end_date_planned = today + timedelta(days=21)
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

        estimate, _ = Estimate.objects.get_or_create(
            created_by=user,
            project=project,
            version=1,
            defaults={
                "status": Estimate.Status.APPROVED,
                "title": "Bathroom Remodel Estimate v1",
                "subtotal": Decimal("1000.00"),
                "markup_total": Decimal("0.00"),
                "tax_percent": Decimal("0.00"),
                "tax_total": Decimal("0.00"),
                "grand_total": Decimal("1000.00"),
            },
        )
        estimate.status = Estimate.Status.APPROVED
        estimate.title = "Bathroom Remodel Estimate v1"
        estimate.subtotal = Decimal("1000.00")
        estimate.markup_total = Decimal("0.00")
        estimate.tax_percent = Decimal("0.00")
        estimate.tax_total = Decimal("0.00")
        estimate.grand_total = Decimal("1000.00")
        estimate.save(
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

        line_demo, _ = EstimateLineItem.objects.get_or_create(
            estimate=estimate,
            cost_code=code_demo,
            description="Demo",
            defaults={
                "quantity": Decimal("1.00"),
                "unit": "ea",
                "unit_cost": Decimal("200.00"),
                "markup_percent": Decimal("0.00"),
                "line_total": Decimal("200.00"),
            },
        )
        line_demo.quantity = Decimal("1.00")
        line_demo.unit = "ea"
        line_demo.unit_cost = Decimal("200.00")
        line_demo.markup_percent = Decimal("0.00")
        line_demo.line_total = Decimal("200.00")
        line_demo.save(
            update_fields=["quantity", "unit", "unit_cost", "markup_percent", "line_total", "updated_at"]
        )

        line_tile, _ = EstimateLineItem.objects.get_or_create(
            estimate=estimate,
            cost_code=code_tile,
            description="Tile",
            defaults={
                "quantity": Decimal("1.00"),
                "unit": "ea",
                "unit_cost": Decimal("800.00"),
                "markup_percent": Decimal("0.00"),
                "line_total": Decimal("800.00"),
            },
        )
        line_tile.quantity = Decimal("1.00")
        line_tile.unit = "ea"
        line_tile.unit_cost = Decimal("800.00")
        line_tile.markup_percent = Decimal("0.00")
        line_tile.line_total = Decimal("800.00")
        line_tile.save(
            update_fields=["quantity", "unit", "unit_cost", "markup_percent", "line_total", "updated_at"]
        )

        EstimateStatusEvent.objects.get_or_create(
            estimate=estimate,
            from_status=None,
            to_status=Estimate.Status.DRAFT,
            note="Estimate created.",
            changed_by=user,
        )
        EstimateStatusEvent.objects.get_or_create(
            estimate=estimate,
            from_status=Estimate.Status.DRAFT,
            to_status=Estimate.Status.APPROVED,
            note="Approved by homeowner.",
            changed_by=user,
        )

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
            defaults={"email": "ap@tilevendor.example"},
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
        self.stdout.write(f"Project ID: {project.id}")
        self.stdout.write("Manual flow entry points:")
        self.stdout.write("- /intake/quick-add")
        self.stdout.write("- /projects")
        self.stdout.write("- /estimates")
        self.stdout.write("- /budgets")
        self.stdout.write("- /change-orders")
        self.stdout.write("- /invoices")
        self.stdout.write("- /vendor-bills")
        self.stdout.write("- /payments")
