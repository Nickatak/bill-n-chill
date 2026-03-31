from datetime import timedelta

from django.utils import timezone

from core.serializers import QuoteWriteSerializer
from core.tests.common import *


def _verified_session(public_token, document_type, document_id, email):
    """Create a verified OTP session for public decision tests."""
    session = DocumentAccessSession(
        document_type=document_type,
        document_id=document_id,
        public_token=public_token,
        recipient_email=email,
    )
    session.save()
    session.verified_at = timezone.now()
    session.session_expires_at = timezone.now() + timedelta(minutes=60)
    session.save(update_fields=["verified_at", "session_expires_at"])
    return session


class QuoteTests(TestCase):
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
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)

        self.customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner C",
            email="ownerc@example.com",
            phone="555-3333",
            billing_address="3 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Quote Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )
        self.second_project = Project.objects.create(
            organization=self.org,
            customer=self.customer,
            name="Second Property Project",
            status=Project.Status.PROSPECT,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Owner D",
            email="ownerd@example.com",
            phone="555-4444",
            billing_address="4 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Quote Project",
            status=Project.Status.PROSPECT,
            created_by=self.other_user,
        )

        self.cost_code, _ = CostCode.objects.get_or_create(
            code="01-100",
            organization=self.org,
            defaults={
                "name": "General Conditions",
                "is_active": True,
                "created_by": self.user,
            },
        )

    def _bootstrap_primary_membership(self):
        response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "pm8@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        return OrganizationMembership.objects.select_related("organization").get(user=self.user)

    def test_public_quote_detail_view_allows_unauthenticated_access(self):
        quote = Quote.objects.create(
            project=self.project,
            version=1,
            title="Public Quote",
            created_by=self.user,
            status=Quote.Status.SENT,
        )
        QuoteLineItem.objects.create(
            quote=quote,
            cost_code=self.cost_code,
            description="Demo and prep",
            quantity="2",
            unit="day",
            unit_price="500",
            markup_percent="10",
            line_total="1100",
        )

        response = self.client.get(f"/api/v1/public/quotes/{quote.public_token}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["id"], quote.id)
        self.assertEqual(payload["title"], "Public Quote")
        self.assertTrue(payload["public_ref"].endswith(f"--{quote.public_token}"))
        self.assertEqual(payload["project_context"]["id"], self.project.id)
        self.assertEqual(
            payload["project_context"]["customer_display_name"],
            self.customer.display_name,
        )
        self.assertIn("organization_context", payload)
        self.assertIn("display_name", payload["organization_context"])
        self.assertIn("help_email", payload["organization_context"])
        self.assertEqual(len(payload["line_items"]), 1)

    def test_public_quote_detail_view_not_found(self):
        response = self.client.get("/api/v1/public/quotes/notarealtoken/")
        self.assertEqual(response.status_code, 404)

    def test_public_quote_decision_view_approves_sent_quote(self):
        quote = Quote.objects.create(
            project=self.project,
            version=1,
            title="Public Quote Approval",
            created_by=self.user,
            status=Quote.Status.SENT,
        )
        QuoteLineItem.objects.create(
            quote=quote,
            cost_code=self.cost_code,
            description="Demo and prep",
            quantity="2",
            unit="day",
            unit_price="500",
            markup_percent="10",
            line_total="1100",
        )

        session = _verified_session(
            quote.public_token, "quote", quote.id, self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/quotes/{quote.public_token}/decision/",
            data={
                "decision": "approve",
                "note": "Looks good.",
                "session_token": session.session_token,
                "signer_name": "Owner",
                "consent_accepted": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["status"], Quote.Status.APPROVED)

        quote.refresh_from_db()
        self.assertEqual(quote.status, Quote.Status.APPROVED)
        self.project.refresh_from_db()
        self.assertEqual(self.project.status, Project.Status.ACTIVE)
        latest_event = QuoteStatusEvent.objects.filter(quote=quote).first()
        self.assertIsNotNone(latest_event)
        self.assertEqual(latest_event.from_status, Quote.Status.SENT)
        self.assertEqual(latest_event.to_status, Quote.Status.APPROVED)
        self.assertIn("Approved via public link", latest_event.note)

    def test_public_quote_decision_view_rejects_sent_quote(self):
        quote = Quote.objects.create(
            project=self.project,
            version=1,
            title="Public Quote Rejection",
            created_by=self.user,
            status=Quote.Status.SENT,
        )

        session = _verified_session(
            quote.public_token, "quote", quote.id, self.customer.email,
        )
        response = self.client.post(
            f"/api/v1/public/quotes/{quote.public_token}/decision/",
            data={
                "decision": "reject",
                "session_token": session.session_token,
                "signer_name": "Owner",
                "consent_accepted": True,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], Quote.Status.REJECTED)

        quote.refresh_from_db()
        self.assertEqual(quote.status, Quote.Status.REJECTED)
        latest_event = QuoteStatusEvent.objects.filter(quote=quote).first()
        self.assertIsNotNone(latest_event)
        self.assertEqual(latest_event.from_status, Quote.Status.SENT)
        self.assertEqual(latest_event.to_status, Quote.Status.REJECTED)

    def test_quote_contract_requires_authentication(self):
        response = self.client.get("/api/v1/contracts/quotes/")
        self.assertEqual(response.status_code, 401)

    def test_quote_contract_matches_model_transition_policy(self):
        response = self.client.get(
            "/api/v1/contracts/quotes/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]

        expected_statuses = [status for status, _label in Quote.Status.choices]
        expected_labels = {status: label for status, label in Quote.Status.choices}
        expected_transitions = {}
        for status in expected_statuses:
            next_statuses = list(Quote.ALLOWED_STATUS_TRANSITIONS.get(status, set()))
            next_statuses.sort(key=lambda value: expected_statuses.index(value))
            expected_transitions[status] = next_statuses
        expected_terminal_statuses = [
            status for status in expected_statuses if not expected_transitions.get(status, [])
        ]

        self.assertEqual(payload["statuses"], expected_statuses)
        self.assertEqual(payload["status_labels"], expected_labels)
        self.assertEqual(payload["default_create_status"], Quote.Status.DRAFT)
        self.assertEqual(
            payload["default_status_filters"],
            [
                Quote.Status.DRAFT,
                Quote.Status.SENT,
                Quote.Status.APPROVED,
                Quote.Status.REJECTED,
            ],
        )
        self.assertEqual(payload["allowed_status_transitions"], expected_transitions)
        self.assertEqual(payload["terminal_statuses"], expected_terminal_statuses)
        self.assertEqual(
            payload["quick_action_by_status"],
            {
                Quote.Status.APPROVED: "change_order",
                Quote.Status.REJECTED: "revision",
                Quote.Status.VOID: "revision",
            },
        )
        self.assertTrue(str(payload["policy_version"]).startswith("2026-02-24.quotes."))

    def test_project_quotes_create(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Initial Quote",
                "tax_percent": "8.25",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "2",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "10",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Quote.objects.count(), 1)
        quote = Quote.objects.first()
        self.assertEqual(quote.version, 1)
        self.assertEqual(str(quote.subtotal), "1000.00")
        self.assertEqual(str(quote.markup_total), "100.00")

    def test_project_quotes_create_persists_valid_through(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Quote With Valid Through",
                "valid_through": "2026-06-30",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["valid_through"], "2026-06-30")

        quote = Quote.objects.get(id=payload["id"])
        self.assertEqual(str(quote.valid_through), "2026-06-30")

    def test_project_quotes_create_uses_organization_validation_delta_when_valid_through_omitted(self):
        membership = self._bootstrap_primary_membership()
        membership.organization.default_quote_valid_delta = 14
        membership.organization.save(update_fields=["default_quote_valid_delta", "updated_at"])

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Quote Uses Validation Delta",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        expected_valid_through = timezone.localdate() + timedelta(days=14)
        self.assertEqual(payload["valid_through"], expected_valid_through.isoformat())

        quote = Quote.objects.get(id=payload["id"])
        self.assertEqual(quote.valid_through, expected_valid_through)

    def test_project_quotes_create_uses_organization_default_terms_when_omitted(self):
        membership = self._bootstrap_primary_membership()
        membership.organization.quote_terms_and_conditions = "Org default quote terms."
        membership.organization.save(update_fields=["quote_terms_and_conditions", "updated_at"])

        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Quote Default Terms",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["terms_text"], "Org default quote terms.")

    def test_project_quotes_rejects_per_quote_terms_overrides(self):
        self._bootstrap_primary_membership()
        create_with_override = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Quote Terms Override",
                "terms_text": "Custom quote terms v1.",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create_with_override.status_code, 400)
        self.assertEqual(create_with_override.json()["error"]["code"], "validation_error")
        self.assertIn("terms_text", create_with_override.json()["error"]["fields"])

        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Quote Terms Base",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        quote_id = create.json()["data"]["id"]

        patch = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"terms_text": "Custom quote terms v2."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(patch.status_code, 400)
        self.assertEqual(patch.json()["error"]["code"], "validation_error")
        self.assertIn("terms_text", patch.json()["error"]["fields"])

    def test_project_quotes_patch_rejects_terms_edit_when_non_draft(self):
        self._bootstrap_primary_membership()
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Locked Terms",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        quote_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        locked_patch = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"terms_text": "Cannot change once sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(locked_patch.status_code, 400)
        self.assertEqual(locked_patch.json()["error"]["code"], "validation_error")
        self.assertIn("terms_text", locked_patch.json()["error"]["fields"])

    def test_project_quotes_create_rounds_tax_half_up_to_cents(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Rounding Quote",
                "tax_percent": "10.00",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Tiny taxable line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "0.05",
                        "markup_percent": "0.00",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()["data"]
        self.assertEqual(payload["subtotal"], "0.05")
        self.assertEqual(payload["tax_total"], "0.01")
        self.assertEqual(payload["grand_total"], "0.06")

    def test_project_quotes_create_requires_title(self):
        missing = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(missing.status_code, 400)

        blank = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "   ",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blank.status_code, 400)

    def test_project_quotes_create_archives_previous_family(self):
        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Kitchen Demo",
                "status": "sent",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
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
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Kitchen Demo",
                "allow_existing_title_family": True,
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Prep and haul",
                        "quantity": "2",
                        "unit": "day",
                        "unit_price": "450",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second.status_code, 201)

        first_quote = Quote.objects.get(id=first_id)
        self.assertEqual(first_quote.status, Quote.Status.ARCHIVED)
        self.assertTrue(
            QuoteStatusEvent.objects.filter(
                quote_id=first_id,
                to_status=Quote.Status.ARCHIVED,
            ).exists()
        )

    def test_project_quotes_create_requires_explicit_confirmation_for_existing_title_family(self):
        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Collision Demo",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)

        conflict = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Collision Demo",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Second version attempt without confirmation",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "600",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["error"]["code"], "quote_family_exists")

    def test_project_quotes_create_blocks_existing_title_family_after_approval(self):
        first = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Approved Family Lock",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(first.status_code, 201)
        quote_id = first.json()["data"]["id"]

        to_sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)

        to_approved = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)

        blocked = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Approved Family Lock",
                "allow_existing_title_family": True,
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Follow-up draft should be blocked",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "600",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["error"]["code"], "quote_family_approved_locked")

    def test_project_quotes_create_rejects_user_archived_status(self):
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Should Fail",
                "status": "archived",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"]["fields"]["status"][0],
            "Archived status is system-controlled and cannot be set directly.",
        )

    def test_project_quotes_list_scoped_by_project_and_user(self):
        Quote.objects.create(
            project=self.project,
            version=1,
            title="Mine",
            created_by=self.user,
        )
        Quote.objects.create(
            project=self.other_project,
            version=1,
            title="Other",
            created_by=self.other_user,
        )
        response = self.client.get(
            f"/api/v1/projects/{self.project.id}/quotes/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Mine")

    def test_quote_status_write_contract_distinguishes_void_from_archived(self):
        archived_serializer = QuoteWriteSerializer(
            data={
                "title": "Contract Test",
                "status": "archived",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                        "markup_percent": "0.00",
                    }
                ],
            }
        )
        self.assertFalse(archived_serializer.is_valid())
        self.assertIn("status", archived_serializer.errors)
        self.assertIn(
            "Archived status is system-controlled and cannot be set directly.",
            archived_serializer.errors["status"],
        )

        void_serializer = QuoteWriteSerializer(
            data={
                "title": "Contract Test",
                "status": "void",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo line",
                        "quantity": "1",
                        "unit": "ea",
                        "unit_price": "100.00",
                        "markup_percent": "0.00",
                    }
                ],
            }
        )
        self.assertTrue(void_serializer.is_valid(), void_serializer.errors)
        self.assertEqual(void_serializer.validated_data["status"], Quote.Status.VOID)

    def test_quote_status_transition_validates_allowed_paths(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Initial Quote",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        invalid = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "rejected"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")
        self.assertEqual(
            invalid.json()["error"]["message"],
            "Quote must be sent before it can be approved or rejected.",
        )

        invalid_approved = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid_approved.status_code, 400)
        self.assertEqual(invalid_approved.json()["error"]["code"], "validation_error")
        self.assertEqual(
            invalid_approved.json()["error"]["message"],
            "Quote must be sent before it can be approved or rejected.",
        )

        to_sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)
        self.assertEqual(to_sent.json()["data"]["status"], "sent")

        to_approved = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)
        self.assertEqual(to_approved.json()["data"]["status"], "approved")

    def test_quote_patch_approval_promotes_project_to_active(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Prospect Activation Quote",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Activation scope",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create.status_code, 201)
        quote_id = create.json()["data"]["id"]

        to_sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_sent.status_code, 200)

        to_approved = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(to_approved.status_code, 200)

        self.project.refresh_from_db()
        self.assertEqual(self.project.status, Project.Status.ACTIVE)

    def test_quote_status_transition_allows_sent_to_void(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Void Block",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        voided = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "void"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(voided.status_code, 200)
        self.assertEqual(voided.json()["data"]["status"], Quote.Status.VOID)

        quote = Quote.objects.get(id=quote_id)
        self.assertEqual(quote.status, Quote.Status.VOID)

    def test_quote_status_transition_rejects_user_archived_patch(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Archived Patch Block",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        response = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "archived"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["error"]["fields"]["status"][0],
            "Archived status is system-controlled and cannot be set directly.",
        )

    def test_quote_status_transition_creates_audit_events(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Initial Quote",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent", "status_note": "Sent to owner for review."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "rejected", "status_note": "Owner requested adjustments."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        events = QuoteStatusEvent.objects.filter(quote_id=quote_id)
        self.assertEqual(events.count(), 3)
        latest = events.first()
        self.assertEqual(latest.from_status, Quote.Status.SENT)
        self.assertEqual(latest.to_status, Quote.Status.REJECTED)
        self.assertEqual(latest.note, "Owner requested adjustments.")

        response = self.client.get(
            f"/api/v1/quotes/{quote_id}/status-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 3)

    def test_quote_resend_records_sent_to_sent_status_event(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Resend Quote",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent", "status_note": "Initial send."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        resent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent", "status_note": "Re-sent after follow-up call."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(resent.status_code, 200)

        events = QuoteStatusEvent.objects.filter(quote_id=quote_id)
        self.assertEqual(events.count(), 3)
        latest = events.first()
        self.assertEqual(latest.from_status, Quote.Status.SENT)
        self.assertEqual(latest.to_status, Quote.Status.SENT)
        self.assertEqual(latest.note, "Re-sent after follow-up call.")

    def test_quote_terminal_status_note_records_same_status_event(self):
        approved_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Approved Note Event Quote",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        approved_quote_id = approved_create.json()["data"]["id"]
        self.client.patch(
            f"/api/v1/quotes/{approved_quote_id}/",
            data={"status": "sent", "status_note": "Sent for approval."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/quotes/{approved_quote_id}/",
            data={"status": "approved", "status_note": "Approved by owner."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )

        approved_note = self.client.patch(
            f"/api/v1/quotes/{approved_quote_id}/",
            data={"status": "approved", "status_note": "Final approved terms acknowledged."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved_note.status_code, 200)
        approved_events = QuoteStatusEvent.objects.filter(quote_id=approved_quote_id)
        approved_latest = approved_events.first()
        self.assertEqual(approved_latest.from_status, Quote.Status.APPROVED)
        self.assertEqual(approved_latest.to_status, Quote.Status.APPROVED)
        self.assertEqual(approved_latest.note, "Final approved terms acknowledged.")
        approved_history = self.client.get(
            f"/api/v1/quotes/{approved_quote_id}/status-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved_history.status_code, 200)
        self.assertEqual(approved_history.json()["data"][0]["action_type"], "notate")

        void_create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Void Note Event Quote",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        void_quote_id = void_create.json()["data"]["id"]
        self.client.patch(
            f"/api/v1/quotes/{void_quote_id}/",
            data={"status": "sent", "status_note": "Sent to owner."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.client.patch(
            f"/api/v1/quotes/{void_quote_id}/",
            data={"status": "void", "status_note": "Voided after owner cancellation."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        void_note = self.client.patch(
            f"/api/v1/quotes/{void_quote_id}/",
            data={"status": "void", "status_note": "Closed and archived for records."},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(void_note.status_code, 200)
        void_events = QuoteStatusEvent.objects.filter(quote_id=void_quote_id)
        void_latest = void_events.first()
        self.assertEqual(void_latest.from_status, Quote.Status.VOID)
        self.assertEqual(void_latest.to_status, Quote.Status.VOID)
        self.assertEqual(void_latest.note, "Closed and archived for records.")

    def test_quote_values_locked_after_send(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Lock After Send",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        locked = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"title": "New Title"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(locked.status_code, 400)

        locked_valid_through = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"valid_through": "2026-07-31"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(locked_valid_through.status_code, 400)

        approved = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "approved"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(approved.status_code, 200)

    def test_quote_title_cannot_change_after_creation_even_in_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "Original Title",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        rename = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"title": "Renamed Title"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(rename.status_code, 400)
        self.assertEqual(rename.json()["error"]["code"], "validation_error")
        self.assertEqual(
            rename.json()["error"]["message"],
            "Quote title cannot be changed after creation.",
        )

    def test_quote_cannot_transition_from_sent_back_to_draft(self):
        create = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data={
                "title": "No Revert To Draft",
                "line_items": [
                    {
                        "cost_code": self.cost_code.id,
                        "description": "Demo and prep",
                        "quantity": "1",
                        "unit": "day",
                        "unit_price": "500",
                        "markup_percent": "0",
                    }
                ],
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        quote_id = create.json()["data"]["id"]

        sent = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "sent"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(sent.status_code, 200)

        invalid = self.client.patch(
            f"/api/v1/quotes/{quote_id}/",
            data={"status": "draft"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["error"]["code"], "validation_error")

    # -----------------------------------------------------------------------
    # Billing period validation
    # -----------------------------------------------------------------------

    def _base_quote_payload(self, **overrides):
        """Base payload for quote creation with one line item."""
        payload = {
            "title": "Schedule Test",
            "tax_percent": "0",
            "line_items": [
                {
                    "cost_code": self.cost_code.id,
                    "description": "Test item",
                    "quantity": "1",
                    "unit": "ea",
                    "unit_price": "1000",
                    "markup_percent": "0",
                }
            ],
        }
        payload.update(overrides)
        return payload

    def test_billing_periods_exact_100_accepted(self):
        """Billing periods summing to exactly 100.00% are accepted."""
        payload = self._base_quote_payload(billing_periods=[
            {"description": "Deposit", "percent": "50.00", "order": 0},
            {"description": "Final", "percent": "50.00", "order": 1},
        ])
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)
        quote = response.json()["data"]
        self.assertEqual(len(quote.get("billing_periods", [])), 2)

    def test_billing_periods_single_100_accepted(self):
        """A single 100% billing period is accepted."""
        payload = self._base_quote_payload(billing_periods=[
            {"description": "Lump sum", "percent": "100.00", "order": 0},
        ])
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)

    def test_billing_periods_99_99_rejected(self):
        """Three-way split of 33.33% each (99.99%) is rejected."""
        payload = self._base_quote_payload(billing_periods=[
            {"description": "Phase 1", "percent": "33.33", "order": 0},
            {"description": "Phase 2", "percent": "33.33", "order": 1},
            {"description": "Phase 3", "percent": "33.33", "order": 2},
        ])
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        error = response.json()["error"]
        self.assertIn("100%", error["message"])
        self.assertIn("99.99", error["message"])
        # Verify no field prefix in the message
        self.assertNotIn("billing_periods:", error["message"])

    def test_billing_periods_100_01_rejected(self):
        """Periods summing to 100.01% are rejected."""
        payload = self._base_quote_payload(billing_periods=[
            {"description": "Deposit", "percent": "50.01", "order": 0},
            {"description": "Final", "percent": "50.00", "order": 1},
        ])
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("100%", response.json()["error"]["message"])

    def test_billing_periods_three_way_exact_split_accepted(self):
        """33.33 + 33.33 + 33.34 = 100.00 is accepted."""
        payload = self._base_quote_payload(billing_periods=[
            {"description": "Phase 1", "percent": "33.33", "order": 0},
            {"description": "Phase 2", "percent": "33.33", "order": 1},
            {"description": "Phase 3", "percent": "33.34", "order": 2},
        ])
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)

    def test_billing_periods_empty_list_accepted(self):
        """Empty billing_periods list is valid (no schedule)."""
        payload = self._base_quote_payload(billing_periods=[])
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 201)

    def test_billing_periods_blank_description_rejected(self):
        """Billing period with blank description is rejected."""
        payload = self._base_quote_payload(billing_periods=[
            {"description": "", "percent": "100.00", "order": 0},
        ])
        response = self.client.post(
            f"/api/v1/projects/{self.project.id}/quotes/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("description", response.json()["error"]["message"].lower())

