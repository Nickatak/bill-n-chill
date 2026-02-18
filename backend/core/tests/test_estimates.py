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
        self.assertEqual(original.status, Estimate.Status.ARCHIVED)

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

        to_approved = self.client.patch(
            f"/api/v1/estimates/{estimate_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)
        self.assertEqual(to_approved.json()["data"]["status"], "approved")

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
