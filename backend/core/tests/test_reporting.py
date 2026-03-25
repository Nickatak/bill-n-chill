"""Tests for reporting and dashboard endpoints.

Covers: portfolio_snapshot_view, change_impact_summary_view,
attention_feed_view, quick_jump_search_view, project_timeline_events_view.
"""

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from core.tests.common import *


class ReportingTestBase(TestCase):
    """Shared setUp for all reporting tests."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="reporter",
            email="reporter@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)

        self.other_user = User.objects.create_user(
            username="other-reporter",
            email="other-reporter@example.com",
            password="secret123",
        )
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)
        self.other_org = _bootstrap_org(self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Report Customer",
            email="cust@example.com",
            phone="555-0001",
            billing_address="1 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Alpha Project",
            status=Project.Status.ACTIVE,
            contract_value_original="100000.00",
            contract_value_current="100000.00",
            created_by=self.user,
        )
        self.vendor = Vendor.objects.create(
            organization=self.org,
            name="Test Vendor",
            created_by=self.user,
        )

    def _auth(self, token=None):
        return {"HTTP_AUTHORIZATION": f"Token {(token or self.token).key}"}


class PortfolioSnapshotTests(ReportingTestBase):

    def test_returns_empty_portfolio_with_no_data(self):
        response = self.client.get("/api/v1/reports/portfolio/", **self._auth())
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["active_projects_count"], 1)
        self.assertEqual(len(data["projects"]), 1)
        self.assertEqual(data["overdue_invoice_count"], 0)
        self.assertEqual(data["overdue_vendor_bill_count"], 0)

    def test_counts_overdue_invoices(self):
        today = timezone.localdate()
        Invoice.objects.create(
            project=self.project,
            customer=self.customer,
            invoice_number="INV-001",
            issue_date=today - timedelta(days=30),
            due_date=today - timedelta(days=1),
            status=Invoice.Status.SENT,
            created_by=self.user,
        )
        # Paid invoice should NOT count as overdue
        Invoice.objects.create(
            project=self.project,
            customer=self.customer,
            invoice_number="INV-002",
            issue_date=today - timedelta(days=30),
            due_date=today - timedelta(days=1),
            status=Invoice.Status.CLOSED,
            created_by=self.user,
        )
        response = self.client.get("/api/v1/reports/portfolio/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["overdue_invoice_count"], 1)

    def test_counts_overdue_vendor_bills(self):
        today = timezone.localdate()
        VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="VB-001",
            issue_date=today - timedelta(days=30),
            due_date=today - timedelta(days=1),
            status=VendorBill.Status.OPEN,
            created_by=self.user,
        )
        response = self.client.get("/api/v1/reports/portfolio/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["overdue_vendor_bill_count"], 1)

    def test_org_scoping_excludes_other_org_data(self):
        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Customer",
            email="other@example.com",
            phone="555-0002",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Project",
            status=Project.Status.ACTIVE,
            contract_value_original="50000.00",
            contract_value_current="50000.00",
            created_by=self.other_user,
        )
        today = timezone.localdate()
        Invoice.objects.create(
            project=other_project,
            customer=other_customer,
            invoice_number="INV-OTHER",
            issue_date=today - timedelta(days=30),
            due_date=today - timedelta(days=1),
            status=Invoice.Status.SENT,
            created_by=self.other_user,
        )
        # User's org should see 0 overdue
        response = self.client.get("/api/v1/reports/portfolio/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["overdue_invoice_count"], 0)
        self.assertEqual(len(data["projects"]), 1)  # only Alpha Project

    def test_invalid_date_filter_returns_400(self):
        response = self.client.get(
            "/api/v1/reports/portfolio/?date_from=not-a-date", **self._auth()
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_unauthenticated_returns_401(self):
        response = self.client.get("/api/v1/reports/portfolio/")
        self.assertEqual(response.status_code, 401)


class ChangeImpactSummaryTests(ReportingTestBase):

    def test_returns_empty_when_no_approved_change_orders(self):
        response = self.client.get("/api/v1/reports/change-impact/", **self._auth())
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["approved_change_orders_count"], 0)
        self.assertEqual(len(data["projects"]), 0)

    def test_counts_approved_change_orders(self):
        ChangeOrder.objects.create(
            project=self.project,
            family_key="A1",
            title="Extra Foundation",
            amount_delta=Decimal("5000.00"),
            status=ChangeOrder.Status.APPROVED,
            approved_at=timezone.now(),
            approved_by=self.user,
            requested_by=self.user,
        )
        ChangeOrder.objects.create(
            project=self.project,
            family_key="A2",
            title="Draft CO",
            amount_delta=Decimal("2000.00"),
            status=ChangeOrder.Status.DRAFT,
            requested_by=self.user,
        )
        response = self.client.get("/api/v1/reports/change-impact/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["approved_change_orders_count"], 1)
        self.assertEqual(len(data["projects"]), 1)
        self.assertEqual(data["projects"][0]["project_name"], "Alpha Project")

    def test_org_scoping_excludes_other_org_change_orders(self):
        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Customer",
            email="other@example.com",
            phone="555-0002",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        ChangeOrder.objects.create(
            project=other_project,
            family_key="X1",
            title="Other CO",
            amount_delta=Decimal("9999.00"),
            status=ChangeOrder.Status.APPROVED,
            approved_at=timezone.now(),
            approved_by=self.other_user,
            requested_by=self.other_user,
        )
        response = self.client.get("/api/v1/reports/change-impact/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["approved_change_orders_count"], 0)


class AttentionFeedTests(ReportingTestBase):

    def test_returns_empty_feed_when_nothing_is_actionable(self):
        response = self.client.get("/api/v1/reports/attention-feed/", **self._auth())
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 0)
        self.assertEqual(len(data["items"]), 0)

    def test_overdue_invoices_appear_as_high_severity(self):
        today = timezone.localdate()
        Invoice.objects.create(
            project=self.project,
            customer=self.customer,
            invoice_number="INV-LATE",
            issue_date=today - timedelta(days=30),
            due_date=today - timedelta(days=1),
            status=Invoice.Status.SENT,
            created_by=self.user,
        )
        response = self.client.get("/api/v1/reports/attention-feed/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 1)
        item = data["items"][0]
        self.assertEqual(item["kind"], "overdue_invoice")
        self.assertEqual(item["severity"], "high")

    def test_due_soon_vendor_bills_appear_as_medium_severity(self):
        today = timezone.localdate()
        VendorBill.objects.create(
            project=self.project,
            vendor=self.vendor,
            bill_number="VB-SOON",
            issue_date=today - timedelta(days=10),
            due_date=today + timedelta(days=3),
            status=VendorBill.Status.OPEN,
            created_by=self.user,
        )
        response = self.client.get("/api/v1/reports/attention-feed/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 1)
        item = data["items"][0]
        self.assertEqual(item["kind"], "vendor_bill_due_soon")
        self.assertEqual(item["severity"], "medium")

    def test_pending_change_orders_appear_as_medium_severity(self):
        ChangeOrder.objects.create(
            project=self.project,
            family_key="B1",
            title="Needs Approval",
            amount_delta=Decimal("1500.00"),
            status=ChangeOrder.Status.SENT,
            requested_by=self.user,
        )
        response = self.client.get("/api/v1/reports/attention-feed/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 1)
        self.assertEqual(data["items"][0]["kind"], "change_order_sent")

    def test_void_payments_appear_as_low_severity(self):
        Payment.objects.create(
            organization=self.org,
            project=self.project,
            direction=Payment.Direction.INBOUND,
            method=Payment.Method.CHECK,
            amount=Decimal("500.00"),
            payment_date=timezone.localdate(),
            status=Payment.Status.VOID,
            created_by=self.user,
        )
        response = self.client.get("/api/v1/reports/attention-feed/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 1)
        self.assertEqual(data["items"][0]["kind"], "payment_problem")
        self.assertEqual(data["items"][0]["severity"], "low")

    def test_items_sorted_by_severity_high_first(self):
        today = timezone.localdate()
        # High: overdue invoice
        Invoice.objects.create(
            project=self.project,
            customer=self.customer,
            invoice_number="INV-OVERDUE",
            issue_date=today - timedelta(days=30),
            due_date=today - timedelta(days=1),
            status=Invoice.Status.SENT,
            created_by=self.user,
        )
        # Low: void payment
        Payment.objects.create(
            organization=self.org,
            project=self.project,
            direction=Payment.Direction.INBOUND,
            method=Payment.Method.CHECK,
            amount=Decimal("100.00"),
            payment_date=today,
            status=Payment.Status.VOID,
            created_by=self.user,
        )
        response = self.client.get("/api/v1/reports/attention-feed/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 2)
        self.assertEqual(data["items"][0]["severity"], "high")
        self.assertEqual(data["items"][1]["severity"], "low")

    def test_org_scoping_excludes_other_org_items(self):
        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Cust",
            email="oc@example.com",
            phone="555-0003",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Proj",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        today = timezone.localdate()
        Invoice.objects.create(
            project=other_project,
            customer=other_customer,
            invoice_number="INV-OTHER-LATE",
            issue_date=today - timedelta(days=30),
            due_date=today - timedelta(days=1),
            status=Invoice.Status.SENT,
            created_by=self.other_user,
        )
        response = self.client.get("/api/v1/reports/attention-feed/", **self._auth())
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 0)


class QuickJumpSearchTests(ReportingTestBase):

    def test_returns_empty_for_short_query(self):
        response = self.client.get("/api/v1/search/quick-jump/?q=A", **self._auth())
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 0)

    def test_returns_empty_for_missing_query(self):
        response = self.client.get("/api/v1/search/quick-jump/", **self._auth())
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 0)

    def test_matches_project_by_name(self):
        response = self.client.get("/api/v1/search/quick-jump/?q=Alpha", **self._auth())
        data = response.json()["data"]
        self.assertGreaterEqual(data["item_count"], 1)
        kinds = [item["kind"] for item in data["items"]]
        self.assertIn("project", kinds)

    def test_matches_invoice_by_number(self):
        today = timezone.localdate()
        Invoice.objects.create(
            project=self.project,
            customer=self.customer,
            invoice_number="INV-SEARCH-42",
            issue_date=today,
            due_date=today + timedelta(days=30),
            created_by=self.user,
        )
        response = self.client.get("/api/v1/search/quick-jump/?q=SEARCH-42", **self._auth())
        data = response.json()["data"]
        self.assertGreaterEqual(data["item_count"], 1)
        kinds = [item["kind"] for item in data["items"]]
        self.assertIn("invoice", kinds)

    def test_matches_change_order_by_family_key(self):
        ChangeOrder.objects.create(
            project=self.project,
            family_key="ROOF-FIX",
            title="Roof Repair",
            amount_delta=Decimal("3000.00"),
            status=ChangeOrder.Status.DRAFT,
            requested_by=self.user,
        )
        response = self.client.get("/api/v1/search/quick-jump/?q=roof-fix", **self._auth())
        data = response.json()["data"]
        self.assertGreaterEqual(data["item_count"], 1)
        kinds = [item["kind"] for item in data["items"]]
        self.assertIn("change_order", kinds)

    def test_org_scoping_excludes_other_org_results(self):
        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Customer",
            email="oc2@example.com",
            phone="555-0004",
            created_by=self.other_user,
        )
        Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Alpha Stealth Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        response = self.client.get("/api/v1/search/quick-jump/?q=Alpha", **self._auth())
        data = response.json()["data"]
        # Should only find our Alpha Project, not the other org's
        project_items = [i for i in data["items"] if i["kind"] == "project"]
        self.assertEqual(len(project_items), 1)
        self.assertEqual(project_items[0]["label"], "Alpha Project")

    def test_case_insensitive_search(self):
        response = self.client.get("/api/v1/search/quick-jump/?q=alpha", **self._auth())
        data = response.json()["data"]
        self.assertGreaterEqual(data["item_count"], 1)

    def test_unauthenticated_returns_401(self):
        response = self.client.get("/api/v1/search/quick-jump/?q=test")
        self.assertEqual(response.status_code, 401)


class ProjectTimelineEventsTests(ReportingTestBase):

    def test_returns_empty_timeline_for_project_with_no_events(self):
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/timeline/", **self._auth()
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 0)
        self.assertEqual(data["project_name"], "Alpha Project")

    def test_returns_estimate_status_events(self):
        estimate = Estimate.objects.create(
            project=self.project,
            title="Foundation Estimate",
            version=1,
            status=Estimate.Status.DRAFT,
            created_by=self.user,
        )
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status="",
            to_status="draft",
            note="Created",
            changed_by=self.user,
        )
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status="draft",
            to_status="sent",
            note="Sent to customer",
            changed_by=self.user,
        )
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/timeline/", **self._auth()
        )
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 2)
        self.assertEqual(data["items"][0]["category"], "workflow")

    def test_workflow_category_filter(self):
        estimate = Estimate.objects.create(
            project=self.project,
            title="Filtered Estimate",
            version=1,
            status=Estimate.Status.DRAFT,
            created_by=self.user,
        )
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status="",
            to_status="draft",
            note="",
            changed_by=self.user,
        )
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/timeline/?category=workflow",
            **self._auth(),
        )
        data = response.json()["data"]
        self.assertEqual(data["category"], "workflow")
        self.assertEqual(data["item_count"], 1)

    def test_financial_category_filter_excludes_workflow_events(self):
        estimate = Estimate.objects.create(
            project=self.project,
            title="Another Estimate",
            version=1,
            status=Estimate.Status.DRAFT,
            created_by=self.user,
        )
        EstimateStatusEvent.record(
            estimate=estimate,
            from_status="",
            to_status="draft",
            note="",
            changed_by=self.user,
        )
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/timeline/?category=financial",
            **self._auth(),
        )
        data = response.json()["data"]
        self.assertEqual(data["item_count"], 0)

    def test_invalid_category_returns_400(self):
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/timeline/?category=bogus",
            **self._auth(),
        )
        self.assertEqual(response.status_code, 400)

    def test_nonexistent_project_returns_404(self):
        response = self.client.get("/api/v1/projects/99999/timeline/", **self._auth())
        self.assertEqual(response.status_code, 404)

    def test_other_org_project_returns_404(self):
        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Other Customer",
            email="oc3@example.com",
            phone="555-0005",
            created_by=self.other_user,
        )
        other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Timeline Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )
        response = self.client.get(
            f"/api/v1/projects/{other_project.id}/timeline/", **self._auth()
        )
        self.assertEqual(response.status_code, 404)
