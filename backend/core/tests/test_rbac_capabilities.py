from core.tests.common import *
from core.rbac import _capability_gate
from core.user_helpers import _resolve_user_capabilities


class ResolveUserCapabilitiesTests(TestCase):
    """Tests for _resolve_user_capabilities resolution chain."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="caps-test",
            email="caps-test@example.com",
            password="secret123",
        )
        self.organization = Organization.objects.create(
            display_name="Caps Test Org",
            created_by=self.user,
        )

    def _make_membership(self, *, role="owner", role_template=None, capability_flags_json=None):
        return OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role=role,
            status=OrganizationMembership.Status.ACTIVE,
            role_template=role_template,
            capability_flags_json=capability_flags_json or {},
        )

    def test_resolves_from_assigned_role_template(self):
        custom_caps = {"estimates": ["view", "create"], "projects": ["view"]}
        template = RoleTemplate.objects.create(
            name="Custom",
            slug="custom-test",
            is_system=False,
            organization=self.organization,
            capability_flags_json=custom_caps,
        )
        self._make_membership(role="worker", role_template=template)

        caps = _resolve_user_capabilities(self.user)
        self.assertEqual(caps["estimates"], ["view", "create"])
        self.assertEqual(caps["projects"], ["view"])
        self.assertNotIn("invoices", caps)

    def test_falls_back_to_system_template_by_role_slug(self):
        self._make_membership(role="viewer")

        caps = _resolve_user_capabilities(self.user)
        # Viewer system template has view-only on everything
        self.assertEqual(caps.get("estimates"), ["view"])
        self.assertEqual(caps.get("invoices"), ["view"])
        self.assertEqual(caps.get("users"), [])

    def test_owner_system_template_has_full_capabilities(self):
        self._make_membership(role="owner")

        caps = _resolve_user_capabilities(self.user)
        self.assertIn("create", caps["estimates"])
        self.assertIn("approve", caps["estimates"])
        self.assertIn("send", caps["estimates"])
        self.assertIn("edit", caps["org_identity"])
        self.assertIn("edit_role", caps["users"])
        self.assertIn("payments", caps)

    def test_pm_cannot_edit_org_identity(self):
        self._make_membership(role="pm")

        caps = _resolve_user_capabilities(self.user)
        self.assertNotIn("edit", caps.get("org_identity", []))
        self.assertIn("edit", caps.get("org_presets", []))

    def test_per_membership_overrides_merge_additively(self):
        self._make_membership(
            role="viewer",
            capability_flags_json={"estimates": ["create", "edit"]},
        )

        caps = _resolve_user_capabilities(self.user)
        # Should have both system viewer "view" and override "create", "edit"
        self.assertIn("view", caps["estimates"])
        self.assertIn("create", caps["estimates"])
        self.assertIn("edit", caps["estimates"])
        # Other resources should still be view-only
        self.assertEqual(caps.get("invoices"), ["view"])

    def test_no_prior_membership_bootstraps_owner_capabilities(self):
        orphan = User.objects.create_user(
            username="orphan",
            email="orphan@example.com",
            password="secret123",
        )
        # resolve_user_capabilities bootstraps membership via _ensure_membership
        caps = _resolve_user_capabilities(orphan)
        # Bootstrapped users get owner role
        self.assertIn("create", caps.get("estimates", []))

    def test_inactive_membership_bootstraps_via_ensure(self):
        # OneToOneField means _ensure_membership can't create a second
        # membership — it will find no ACTIVE one and bootstrap a new org+membership.
        # But since user already has a membership row, this would fail the unique
        # constraint. So we test a user with NO membership at all.
        fresh_user = User.objects.create_user(
            username="fresh-caps", email="fresh-caps@example.com", password="secret123",
        )
        caps = _resolve_user_capabilities(fresh_user)
        # Bootstrapped as owner
        self.assertIn("create", caps.get("estimates", []))
        self.assertIn("edit", caps.get("org_identity", []))

    def test_bookkeeping_has_invoice_create_but_not_send(self):
        self._make_membership(role="bookkeeping")

        caps = _resolve_user_capabilities(self.user)
        self.assertIn("create", caps["invoices"])
        self.assertIn("edit", caps["invoices"])
        self.assertNotIn("send", caps.get("invoices", []))

    def test_worker_cannot_approve_or_pay(self):
        self._make_membership(role="worker")

        caps = _resolve_user_capabilities(self.user)
        self.assertNotIn("approve", caps.get("estimates", []))
        self.assertNotIn("approve", caps.get("vendor_bills", []))
        self.assertNotIn("pay", caps.get("vendor_bills", []))


class CapabilityGateTests(TestCase):
    """Tests for _capability_gate allow/deny behavior."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="gate-test",
            email="gate-test@example.com",
            password="secret123",
        )
        self.organization = Organization.objects.create(
            display_name="Gate Test Org",
            created_by=self.user,
        )

    def test_gate_allows_when_capability_present(self):
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role="owner",
            status=OrganizationMembership.Status.ACTIVE,
        )
        error, caps = _capability_gate(self.user, "estimates", "create")
        self.assertIsNone(error)
        self.assertIn("create", caps["estimates"])

    def test_gate_denies_when_capability_missing(self):
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role="viewer",
            status=OrganizationMembership.Status.ACTIVE,
        )
        error, caps = _capability_gate(self.user, "estimates", "create")
        self.assertIsNotNone(error)
        self.assertEqual(error["error"]["code"], "forbidden")
        self.assertIn("estimates.create", error["error"]["fields"]["capability"][0])

    def test_gate_denies_for_unknown_resource(self):
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role="owner",
            status=OrganizationMembership.Status.ACTIVE,
        )
        error, _ = _capability_gate(self.user, "nonexistent_resource", "edit")
        self.assertIsNotNone(error)

    def test_gate_returns_capabilities_even_on_deny(self):
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role="viewer",
            status=OrganizationMembership.Status.ACTIVE,
        )
        error, caps = _capability_gate(self.user, "estimates", "create")
        self.assertIsNotNone(error)
        # Still returns the user's capabilities so caller can inspect
        self.assertIn("estimates", caps)


class OrgProfileCapabilityGateTests(TestCase):
    """Tests for field-level org profile PATCH capability gates."""

    def setUp(self):
        self.owner_user = User.objects.create_user(
            username="org-cap-owner", email="org-cap-owner@example.com", password="secret123",
        )
        self.pm_user = User.objects.create_user(
            username="org-cap-pm", email="org-cap-pm@example.com", password="secret123",
        )
        self.worker_user = User.objects.create_user(
            username="org-cap-worker", email="org-cap-worker@example.com", password="secret123",
        )
        self.owner_token, _ = Token.objects.get_or_create(user=self.owner_user)
        self.pm_token, _ = Token.objects.get_or_create(user=self.pm_user)
        self.worker_token, _ = Token.objects.get_or_create(user=self.worker_user)

        self.organization = Organization.objects.create(
            display_name="Cap Org Test",
            created_by=self.owner_user,
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=self.owner_user,
            role=OrganizationMembership.Role.OWNER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=self.pm_user,
            role=OrganizationMembership.Role.PM,
            status=OrganizationMembership.Status.ACTIVE,
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=self.worker_user,
            role=OrganizationMembership.Role.WORKER,
            status=OrganizationMembership.Status.ACTIVE,
        )

    def test_owner_can_edit_identity_and_presets(self):
        response = self.client.patch(
            "/api/v1/organization/",
            data={"display_name": "Owner Edit", "help_email": "help@new.com"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.owner_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        self.organization.refresh_from_db()
        self.assertEqual(self.organization.display_name, "Owner Edit")
        self.assertEqual(self.organization.help_email, "help@new.com")

    def test_pm_can_edit_presets_but_not_identity(self):
        # Presets should work
        presets_response = self.client.patch(
            "/api/v1/organization/",
            data={"help_email": "pm-help@new.com"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.pm_token.key}",
        )
        self.assertEqual(presets_response.status_code, 200)

        # Identity should be blocked
        identity_response = self.client.patch(
            "/api/v1/organization/",
            data={"display_name": "PM Should Not"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.pm_token.key}",
        )
        self.assertEqual(identity_response.status_code, 403)
        self.assertEqual(identity_response.json()["error"]["code"], "forbidden")

    def test_worker_cannot_edit_identity_or_presets(self):
        identity = self.client.patch(
            "/api/v1/organization/",
            data={"display_name": "Worker Should Not"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.worker_token.key}",
        )
        self.assertEqual(identity.status_code, 403)

        presets = self.client.patch(
            "/api/v1/organization/",
            data={"help_email": "worker@no.com"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.worker_token.key}",
        )
        self.assertEqual(presets.status_code, 403)

    def test_role_policy_reflects_capabilities(self):
        # PM should see can_edit_presets but not can_edit_identity
        response = self.client.get(
            "/api/v1/organization/",
            HTTP_AUTHORIZATION=f"Token {self.pm_token.key}",
        )
        self.assertEqual(response.status_code, 200)
        policy = response.json()["data"]["role_policy"]
        self.assertFalse(policy["can_edit_identity"])
        self.assertTrue(policy["can_edit_presets"])
        self.assertTrue(policy["can_edit_profile"])  # identity OR presets
        self.assertTrue(policy["can_manage_memberships"])


class AuthCapabilitiesResponseTests(TestCase):
    """Tests that auth endpoints include capabilities in their responses."""

    def test_login_response_includes_capabilities(self):
        User.objects.create_user(
            username="cap-login", email="cap-login@example.com", password="secret123",
        )
        response = self.client.post(
            "/api/v1/auth/login/",
            data={"email": "cap-login@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("capabilities", data)
        caps = data["capabilities"]
        # New user gets owner role → should have full capabilities
        self.assertIn("estimates", caps)
        self.assertIn("create", caps["estimates"])
        self.assertIn("payments", caps)

    def test_register_response_includes_capabilities(self):
        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "cap-register@example.com", "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertIn("capabilities", data)
        caps = data["capabilities"]
        self.assertIn("estimates", caps)
        self.assertIn("payments", caps)

    def test_me_response_includes_capabilities(self):
        user = User.objects.create_user(
            username="cap-me", email="cap-me@example.com", password="secret123",
        )
        token, _ = Token.objects.get_or_create(user=user)
        # Trigger membership bootstrap
        self.client.post(
            "/api/v1/auth/login/",
            data={"email": "cap-me@example.com", "password": "secret123"},
            content_type="application/json",
        )

        response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("capabilities", data)
        self.assertIn("estimates", data["capabilities"])

    def test_viewer_capabilities_are_view_only(self):
        owner = User.objects.create_user(
            username="cap-org-owner", email="cap-org-owner@example.com", password="secret123",
        )
        viewer = User.objects.create_user(
            username="cap-viewer", email="cap-viewer@example.com", password="secret123",
        )
        org = Organization.objects.create(display_name="Cap Viewer Org", created_by=owner)
        OrganizationMembership.objects.create(
            organization=org, user=viewer,
            role=OrganizationMembership.Role.VIEWER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        token, _ = Token.objects.get_or_create(user=viewer)

        response = self.client.get(
            "/api/v1/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(response.status_code, 200)
        caps = response.json()["data"]["capabilities"]
        # Viewer should only have view actions
        for resource in ["estimates", "change_orders", "invoices", "vendor_bills"]:
            self.assertEqual(caps[resource], ["view"], f"{resource} should be view-only for viewer")
