from core.tests.common import *

class EstimateTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm8",
            email="pm8@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm9",
            email="pm9@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)

        self.customer = Customer.objects.create(
            display_name="Owner C",
            email="ownerc@example.com",
            phone="555-3333",
            billing_address="3 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            customer=self.customer,
            name="Estimate Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )
        self.second_project = Project.objects.create(
            customer=self.customer,
            name="Second Property Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            display_name="Owner D",
            email="ownerd@example.com",
            phone="555-4444",
            billing_address="4 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            customer=other_customer,
            name="Other Estimate Project",
            status=Project.Status.PROSPECT,
            created_by=self.other_user,
        )

        self.cost_code = CostCode.objects.create(
            code="01-100",
            name="General Conditions",
            is_active=True,
            created_by=self.user,
        )

    def test_public_estimate_detail_view_allows_unauthenticated_access(self):
        estimate = Estimate.objects.create(
            project=self.project,
            version=1,
            title="Public Estimate",
            created_by=self.user,
            status=Estimate.Status.SENT,
        )
        EstimateLineItem.objects.create(
            estimate=estimate,
            cost_code=self.cost_code,
            description="Demo and prep",
            quantity="2",
            unit="day",
            unit_cost="500",
            markup_percent="10",
            line_total="1100",
        )

        response = self.client.get(f"/api/v1/public/estimates/{estimate.public_token}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["id"], estimate.id)
        self.assertEqual(payload["title"], "Public Estimate")
        self.assertTrue(payload["public_ref"].endswith(f"--{estimate.public_token}"))
        self.assertEqual(payload["project_context"]["id"], self.project.id)
        self.assertEqual(
            payload["project_context"]["customer_display_name"],
            self.customer.display_name,
        )
        self.assertEqual(len(payload["line_items"]), 1)

    def test_public_estimate_detail_view_not_found(self):
        response = self.client.get("/api/v1/public/estimates/notarealtoken/")
        self.assertEqual(response.status_code, 404)

    def test_public_project_snapshot_view_allows_unauthenticated_access(self):
        estimate = Estimate.objects.create(
            project=self.project,
            version=1,
            title="Snapshot Estimate",
            created_by=self.user,
            status=Estimate.Status.APPROVED,
        )
        ChangeOrder.objects.create(
            project=self.project,
            number=1,
            title="Approved CO",
            status=ChangeOrder.Status.APPROVED,
            amount_delta="250.00",
            days_delta=1,
            requested_by=self.user,
            approved_by=self.user,
        )
        invoice = Invoice.objects.create(
            project=self.project,
            customer=self.customer,
            invoice_number="INV-SNAPSHOT-1",
            status=Invoice.Status.SENT,
            issue_date="2026-02-01",
            due_date="2026-03-01",
            subtotal="500.00",
            total="500.00",
            balance_due="500.00",
            created_by=self.user,
        )
        payment = Payment.objects.create(
            project=self.project,
            direction=Payment.Direction.INBOUND,
            method=Payment.Method.ACH,
            status=Payment.Status.SETTLED,
            amount="300.00",
            payment_date="2026-02-05",
            created_by=self.user,
        )
        PaymentAllocation.objects.create(
            payment=payment,
            target_type=PaymentAllocation.TargetType.INVOICE,
            invoice=invoice,
            applied_amount="300.00",
            created_by=self.user,
        )

        response = self.client.get(f"/api/v1/public/projects/{estimate.public_token}/snapshot/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["project"]["id"], self.project.id)
        self.assertEqual(payload["shared_from_estimate"]["estimate_id"], estimate.id)
        self.assertEqual(payload["contract"]["approved_change_orders_total"], "250.00")
        self.assertEqual(payload["invoices"]["total_count"], 1)
        self.assertEqual(payload["payments"]["settled_amount"], "300.00")

    def test_public_project_snapshot_view_not_found(self):
        response = self.client.get("/api/v1/public/projects/notarealtoken/snapshot/")
        self.assertEqual(response.status_code, 404)

    def test_project_estimates_create(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "tax_percent": "8.25",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "2",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "10",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Estimate.objects.count(), 1)
        estimate = Estimate.objects.first()
        self.assertEqual(estimate.version, 1)
        self.assertEqual(str(estimate.subtotal), "1000.00")
        self.assertEqual(str(estimate.markup_total), "100.00")

    def test_project_estimates_create_requires_title(self):
        missing = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(missing.status_code, 400)

        blank = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "   ",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blank.status_code, 400)

    def test_project_estimates_create_archives_previous_family(self):
        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Demo",
                "status": "sent",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)
        first_id = first.json()["data"]["id"]

        second = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Demo",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Prep and haul",
                        "quantity": "2",
                        "unit": "day",
                        "unit_cost": "450",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second.status_code, 201)

        first_estimate = Estimate.objects.get(id=first_id)
        self.assertEqual(first_estimate.status, Estimate.Status.ARCHIVED)
        self.assertTrue(
            EstimateStatusEvent.objects.filter(
                estimate_id=first_id,
                to_status=Estimate.Status.ARCHIVED,
            ).exists()
        )

    def test_project_estimates_create_rejects_user_archived_status(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Should Fail",
                "status": "archived",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["status"][0],
            "Archived status is system-controlled and cannot be set directly.",
        )

    def test_project_estimates_list_scoped_by_project_and_user(self):
        Estimate.objects.create(
            project=self.project,
            version=1,
            title="Mine",
            created_by=self.user,
        )
        Estimate.objects.create(
            project=self.other_project,
            version=1,
            title="Other",
            created_by=self.other_user,
        )
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/estimates/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Mine")

    def test_estimate_clone_creates_next_version(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)
        self.assertEqual(Estimate.objects.filter(project=self.project).count(), 2)
        latest = Estimate.objects.filter(project=self.project).order_by("-version").first()
        self.assertEqual(latest.version, 2)
        self.assertEqual(latest.status, Estimate.Status.DRAFT)
        original = Estimate.objects.get(id=estimate_id)
        self.assertEqual(original.status, Estimate.Status.REJECTED)

    def test_estimate_clone_from_rejected_keeps_source_rejected(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Rejected Source",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        rejected = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(rejected.status_code, 200)

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)

        original = Estimate.objects.get(id=estimate_id)
        self.assertEqual(original.status, Estimate.Status.REJECTED)

    def test_estimate_clone_blocked_when_source_is_approved(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Approved Source",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 400)
        self.assertEqual(clone.json()["error"]["code"], "validation_error")

    def test_estimate_clone_blocked_when_source_is_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Draft Source",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        clone = self.client.post(
            f"/api/v1/estimates/{estimate_id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 400)
        self.assertEqual(clone.json()["error"]["code"], "validation_error")

    def test_estimate_clone_allowed_when_source_is_archived(self):
        source = Estimate.objects.create(
            project=self.project,
            version=1,
            status=Estimate.Status.ARCHIVED,
            title="Archived Source",
            created_by=self.user,
        )

        clone = self.client.post(
            f"/api/v1/estimates/{source.id}/clone-version/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(clone.status_code, 201)
        cloned = clone.json()["data"]
        self.assertEqual(cloned["status"], Estimate.Status.DRAFT)
        self.assertEqual(cloned["title"], source.title)

    def test_estimate_status_transition_validates_allowed_paths(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        invalid = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")
        self.assertEqual(
            invalid.json()["error"]["message"],
            "Estimate must be sent before it can be approved or rejected.",
        )

        invalid_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_approved.status_code, 400)
        self.assertEqual(invalid_approved.json()["error"]["code"], "validation_error")
        self.assertEqual(
            invalid_approved.json()["error"]["message"],
            "Estimate must be sent before it can be approved or rejected.",
        )

        to_sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)
        self.assertEqual(to_sent.json()["data"]["status"], "sent")

        to_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)
        self.assertEqual(to_approved.json()["data"]["status"], "approved")
        self.assertEqual(Budget.objects.filter(source_estimate_id=estimate_id).count(), 1)

    def test_estimate_approval_auto_converts_to_budget_and_manual_convert_is_idempotent(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Auto Budget Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        estimate_id = create.json()["data"]["id"]

        to_sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)

        to_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)
        self.assertEqual(Budget.objects.filter(source_estimate_id=estimate_id).count(), 1)

        convert = self.client.post(
            f"/api/v1/estimates/{estimate_id}/convert-to-budget/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(convert.status_code, 200)
        self.assertEqual(convert.json()["meta"]["conversion_status"], "already_converted")
        self.assertEqual(Budget.objects.filter(source_estimate_id=estimate_id).count(), 1)

    def test_estimate_status_transition_allows_sent_to_archived(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Archived Block",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        archived = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "archived"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.json()["data"]["status"], Estimate.Status.ARCHIVED)

    def test_estimate_status_transition_creates_audit_events(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Initial Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent", "status_note": "Sent to owner for review."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "rejected", "status_note": "Owner requested adjustments."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        events = EstimateStatusEvent.objects.filter(estimate_id=estimate_id)
        self.assertEqual(events.count(), 3)
        latest = events.first()
        self.assertEqual(latest.from_status, Estimate.Status.SENT)
        self.assertEqual(latest.to_status, Estimate.Status.REJECTED)
        self.assertEqual(latest.note, "Owner requested adjustments.")

        response = self.client.get(
            f"/api/v1/estimates/{estimate_id}/status-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 3)

    def test_estimate_resend_records_sent_to_sent_status_event(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Resend Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent", "status_note": "Initial send."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        resent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent", "status_note": "Re-sent after follow-up call."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resent.status_code, 200)

        events = EstimateStatusEvent.objects.filter(estimate_id=estimate_id)
        self.assertEqual(events.count(), 3)
        latest = events.first()
        self.assertEqual(latest.from_status, Estimate.Status.SENT)
        self.assertEqual(latest.to_status, Estimate.Status.SENT)
        self.assertEqual(latest.note, "Re-sent after follow-up call.")

    def test_estimate_values_locked_after_send(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Lock After Send",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        locked = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"title": "New Title"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(locked.status_code, 400)

        approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)

    def test_estimate_title_cannot_change_after_creation_even_in_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Original Title",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        rename = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"title": "Renamed Title"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(rename.status_code, 400)
        self.assertEqual(rename.json()["error"]["code"], "validation_error")
        self.assertEqual(
            rename.json()["error"]["message"],
            "Estimate title cannot be changed after creation.",
        )

    def test_estimate_cannot_transition_from_sent_back_to_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "No Revert To Draft",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        estimate_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        invalid = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "draft"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

    def test_estimate_duplicate_creates_new_draft_without_archiving_source(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Estimate",
                "status": "sent",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        source_id = create.json()["data"]["id"]

        duplicated = self.client.post(
            f"/api/v1/estimates/{source_id}/duplicate/",
            data={
                "project_id": self.second_project.id,
                "title": "Kitchen Estimate - Property B",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicated.status_code, 201)
        duplicated_data = duplicated.json()["data"]
        self.assertEqual(duplicated_data["status"], Estimate.Status.DRAFT)
        self.assertEqual(duplicated_data["title"], "Kitchen Estimate - Property B")
        self.assertEqual(duplicated_data["project"], self.second_project.id)

        source = Estimate.objects.get(id=source_id)
        self.assertEqual(source.status, Estimate.Status.SENT)

    def test_estimate_duplicate_same_project_same_title_requires_revision_flow(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Kitchen Estimate",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        source_id = create.json()["data"]["id"]

        invalid = self.client.post(
            f"/api/v1/estimates/{source_id}/duplicate/",
            data={
                "project_id": self.project.id,
                "title": "Kitchen Estimate",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

    def test_estimate_duplicate_new_titles_start_new_family_at_version_one(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/estimates/",
            data={
                "title": "Title",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_cost": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        self.assertEqual(create.json()["data"]["version"], 1)
        source_id = create.json()["data"]["id"]

        duplicate_one = self.client.post(
            f"/api/v1/estimates/{source_id}/duplicate/",
            data={
                "project_id": self.project.id,
                "title": "Title2",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicate_one.status_code, 201)
        first_copy = duplicate_one.json()["data"]
        self.assertEqual(first_copy["title"], "Title2")
        self.assertEqual(first_copy["version"], 1)

        duplicate_two = self.client.post(
            f"/api/v1/estimates/{first_copy['id']}/duplicate/",
            data={
                "project_id": self.project.id,
                "title": "Title3",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(duplicate_two.status_code, 201)
        second_copy = duplicate_two.json()["data"]
        self.assertEqual(second_copy["title"], "Title3")
        self.assertEqual(second_copy["version"], 1)
