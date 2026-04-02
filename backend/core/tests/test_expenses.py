"""Tests for the quick expense endpoint (POST /projects/<id>/expenses/)."""

from core.tests.common import *


class QuickExpenseTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="expense_user",
            email="expense@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Expense Customer",
            email="customer@example.com",
            phone="555-9000",
            billing_address="10 Expense Ln",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Expense Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )

    def _post_expense(self, project_id=None, **data):
        return self.client.post(
            f"/api/v1/projects/{project_id or self.project.id}/expenses/",
            data=data,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

    def test_requires_authentication(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/expenses/",
            data={"total": "50.00"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_creates_vendor_bill_and_payment(self):
        response = self._post_expense(total="75.50", notes="Lumber run")
        self.assertEqual(response.status_code, 201)
        bill = VendorBill.objects.get(project=self.project)
        self.assertEqual(str(bill.total), "75.50")
        self.assertEqual(str(bill.balance_due), "0.00")
        self.assertEqual(bill.status, VendorBill.Status.OPEN)
        self.assertEqual(bill.notes, "Lumber run")
        self.assertEqual(bill.bill_number, "")

        payment = Payment.objects.get(vendor_bill=bill)
        self.assertEqual(str(payment.amount), "75.50")
        self.assertEqual(payment.direction, Payment.Direction.OUTBOUND)
        self.assertEqual(payment.status, Payment.Status.SETTLED)
        self.assertEqual(payment.target_type, Payment.TargetType.VENDOR_BILL)

    def test_creates_vendor_by_name(self):
        response = self._post_expense(total="25.00", vendor_name="Home Depot")
        self.assertEqual(response.status_code, 201)
        bill = VendorBill.objects.get(project=self.project)
        self.assertIsNotNone(bill.vendor)
        self.assertEqual(bill.vendor.name, "Home Depot")
        self.assertEqual(bill.vendor.organization_id, self.org.id)

    def test_reuses_existing_vendor_by_name(self):
        vendor = Vendor.objects.create(
            name="Home Depot",
            organization=self.org,
            created_by=self.user,
        )
        response = self._post_expense(total="30.00", vendor_name="Home Depot")
        self.assertEqual(response.status_code, 201)
        bill = VendorBill.objects.get(project=self.project)
        self.assertEqual(bill.vendor_id, vendor.id)
        self.assertEqual(Vendor.objects.filter(name="Home Depot", organization=self.org).count(), 1)

    def test_no_vendor_name_creates_expense_without_vendor(self):
        response = self._post_expense(total="15.00")
        self.assertEqual(response.status_code, 201)
        bill = VendorBill.objects.get(project=self.project)
        self.assertIsNone(bill.vendor)

    def test_rejects_missing_total(self):
        response = self._post_expense(notes="no total")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "validation_error")
        self.assertIn("total", response.json()["error"]["fields"])

    def test_rejects_zero_total(self):
        response = self._post_expense(total="0.00")
        self.assertEqual(response.status_code, 400)

    def test_rejects_negative_total(self):
        response = self._post_expense(total="-10.00")
        self.assertEqual(response.status_code, 400)

    def test_rejects_invalid_total(self):
        response = self._post_expense(total="not-a-number")
        self.assertEqual(response.status_code, 400)
        self.assertIn("total", response.json()["error"]["fields"])

    def test_rejects_nonexistent_project(self):
        response = self._post_expense(project_id=99999, total="10.00")
        self.assertEqual(response.status_code, 404)

    def test_rejects_cancelled_project(self):
        self.project.status = Project.Status.CANCELLED
        self.project._skip_transition_validation = True
        self.project.save()
        response = self._post_expense(total="10.00")
        self.assertEqual(response.status_code, 400)

    def test_promotes_prospect_to_active(self):
        prospect = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Prospect Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )
        self._post_expense(project_id=prospect.id, total="50.00")
        prospect.refresh_from_db()
        self.assertEqual(prospect.status, Project.Status.ACTIVE)

    def test_default_payment_method_is_card(self):
        self._post_expense(total="20.00")
        payment = Payment.objects.get(project=self.project)
        self.assertEqual(payment.method, Payment.Method.CARD)

    def test_accepts_custom_payment_method(self):
        self._post_expense(total="20.00", method="cash")
        payment = Payment.objects.get(project=self.project)
        self.assertEqual(payment.method, Payment.Method.CASH)

    def test_invalid_method_falls_back_to_card(self):
        self._post_expense(total="20.00", method="bitcoin")
        payment = Payment.objects.get(project=self.project)
        self.assertEqual(payment.method, Payment.Method.CARD)
