from io import StringIO

from django.core.management import call_command

from core.tests.common import *


class DemoSeedCommandTests(TestCase):
    def test_seed_bob_demo_is_idempotent_and_creates_money_loop_records(self):
        out = StringIO()
        call_command("seed_bob_demo", stdout=out)
        call_command("seed_bob_demo", stdout=out)

        user = User.objects.get(email="test@ex.com")
        project = Project.objects.get(created_by=user, name="Bathroom Remodel (Demo)")
        invoice = Invoice.objects.get(project=project, invoice_number="INV-0001")
        vendor_bill = VendorBill.objects.get(project=project, bill_number="VB-100")

        self.assertEqual(project.status, Project.Status.ACTIVE)
        self.assertEqual(str(project.contract_value_original), "1000.00")
        self.assertEqual(str(project.contract_value_current), "1200.00")
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(vendor_bill.status, VendorBill.Status.PAID)

        self.assertEqual(Estimate.objects.filter(project=project, version=1).count(), 1)
        self.assertEqual(Budget.objects.filter(project=project).count(), 1)
        self.assertEqual(ChangeOrder.objects.filter(project=project, number=1).count(), 1)
        self.assertEqual(Payment.objects.filter(project=project, reference_number="AR-1").count(), 1)
        self.assertEqual(Payment.objects.filter(project=project, reference_number="AP-1").count(), 1)
        self.assertEqual(FinancialAuditEvent.objects.filter(project=project).count() >= 8, True)
