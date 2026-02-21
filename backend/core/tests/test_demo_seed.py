from io import StringIO
from decimal import Decimal

from django.core.management import call_command
from django.db.models import Sum

from core.tests.common import *
from core.models import VendorBillAllocation


class DemoSeedCommandTests(TestCase):
    def test_seed_bob_demo_is_idempotent_and_creates_money_loop_records(self):
        out = StringIO()
        call_command("seed_bob_demo", stdout=out)
        call_command("seed_bob_demo", stdout=out)

        user = User.objects.get(email="test@ex.com")
        project = Project.objects.get(
            created_by=user,
            name="Bathroom Remodel (Demo) - CHILD MODELS (OPEN THIS PROJECT)",
        )
        invoice = Invoice.objects.get(project=project, invoice_number="INV-0001")
        vendor_bill = VendorBill.objects.get(project=project, bill_number="VB-100")

        self.assertEqual(project.status, Project.Status.ACTIVE)
        self.assertEqual(str(project.contract_value_original), "1000.00")
        self.assertEqual(str(project.contract_value_current), "1200.00")
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(vendor_bill.status, VendorBill.Status.PAID)
        self.assertEqual(
            str(
                VendorBillAllocation.objects.filter(vendor_bill=vendor_bill).aggregate(total=Sum("amount"))["total"]
            ),
            "500.00",
        )

        required_allocation_statuses = [
            VendorBill.Status.APPROVED,
            VendorBill.Status.SCHEDULED,
            VendorBill.Status.PAID,
        ]
        for bill in VendorBill.objects.filter(project=project, status__in=required_allocation_statuses):
            allocated_total = (
                VendorBillAllocation.objects.filter(vendor_bill=bill).aggregate(total=Sum("amount"))["total"]
                or Decimal("0.00")
            )
            self.assertEqual(allocated_total, bill.total)

        self.assertEqual(
            Estimate.objects.filter(project=project, title__startswith="STATUS VARIATION ESTIMATE").count(),
            len(Estimate.Status.choices),
        )
        self.assertTrue(
            Estimate.objects.filter(
                project=project,
                title="CHILD MODELS ESTIMATE (OPEN THIS ESTIMATE)",
            ).exists()
        )
        child_family = Estimate.objects.filter(
            project=project,
            title="CHILD MODELS ESTIMATE (OPEN THIS ESTIMATE)",
        ).order_by("version")
        self.assertEqual(child_family.count(), 3)
        self.assertEqual(
            list(child_family.values_list("version", "status")),
            [
                (1, Estimate.Status.ARCHIVED),
                (2, Estimate.Status.REJECTED),
                (3, Estimate.Status.APPROVED),
            ],
        )
        self.assertEqual(
            Estimate.objects.filter(project=project).count(),
            len(Estimate.Status.choices) + 3,
        )
        self.assertGreaterEqual(Budget.objects.filter(project=project).count(), 1)
        self.assertEqual(ChangeOrder.objects.filter(project=project, number=1).count(), 1)
        self.assertEqual(Payment.objects.filter(project=project, reference_number="AR-1").count(), 1)
        self.assertEqual(Payment.objects.filter(project=project, reference_number="AP-1").count(), 1)
        self.assertEqual(FinancialAuditEvent.objects.filter(project=project).count() >= 8, True)
