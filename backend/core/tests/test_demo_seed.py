from io import StringIO

from django.core.management import call_command

from core.tests.common import *
from core.models import (
    ChangeOrder,
    Quote,
    Invoice,
    Payment,
    VendorBill,
)


class AdoptionStageSeedTests(TestCase):
    def test_new_account_has_no_data(self):
        out = StringIO()
        call_command("seed_adoption_stages", stdout=out)
        user = User.objects.get(email="new@test.com")
        self.assertEqual(Customer.objects.filter(created_by=user).count(), 0)
        self.assertEqual(Project.objects.filter(created_by=user).count(), 0)

    def test_early_account_shape(self):
        out = StringIO()
        call_command("seed_adoption_stages", stdout=out)
        user = User.objects.get(email="early@test.com")
        self.assertEqual(Customer.objects.filter(created_by=user).count(), 4)
        self.assertEqual(Project.objects.filter(created_by=user).count(), 2)
        self.assertEqual(Quote.objects.filter(created_by=user).count(), 2)

    def test_mid_account_has_status_coverage(self):
        out = StringIO()
        call_command("seed_adoption_stages", stdout=out)
        user = User.objects.get(email="mid@test.com")

        self.assertEqual(Customer.objects.filter(created_by=user).count(), 12)
        self.assertEqual(Customer.objects.filter(created_by=user, is_archived=True).count(), 1)
        self.assertEqual(Project.objects.filter(created_by=user).count(), 6)

        # One of each project status
        for status, _ in Project.Status.choices:
            self.assertTrue(
                Project.objects.filter(created_by=user, status=status).exists(),
                f"Missing project with status {status}",
            )

        # Quote family with archived → rejected → approved
        family = Quote.objects.filter(
            created_by=user, title="Baker Office Scope"
        ).order_by("version")
        self.assertEqual(family.count(), 3)
        self.assertEqual(
            list(family.values_list("version", "status")),
            [
                (1, Quote.Status.ARCHIVED),
                (2, Quote.Status.REJECTED),
                (3, Quote.Status.APPROVED),
            ],
        )

        # Invoices across statuses
        self.assertGreaterEqual(Invoice.objects.filter(project__created_by=user).count(), 5)
        # Change orders exist
        self.assertGreaterEqual(ChangeOrder.objects.filter(project__created_by=user).count(), 5)
        # Payments exist
        self.assertGreaterEqual(Payment.objects.filter(project__created_by=user).count(), 3)

    def test_late_account_scale(self):
        out = StringIO()
        call_command("seed_adoption_stages", stdout=out)
        user = User.objects.get(email="late@test.com")

        self.assertEqual(Customer.objects.filter(created_by=user).count(), 35)
        self.assertEqual(Customer.objects.filter(created_by=user, is_archived=True).count(), 3)
        self.assertEqual(Project.objects.filter(created_by=user).count(), 18)
        self.assertGreaterEqual(Quote.objects.filter(created_by=user).count(), 18)
        self.assertGreaterEqual(Invoice.objects.filter(project__created_by=user).count(), 10)
        self.assertGreaterEqual(VendorBill.objects.filter(project__created_by=user).count(), 10)
        self.assertGreaterEqual(Payment.objects.filter(project__created_by=user).count(), 5)
