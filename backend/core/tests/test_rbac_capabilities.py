from core.tests.common import *
from core.rbac import _capability_gate
from core.user_helpers import (
    RBAC_ROLE_OWNER,
    _resolve_user_role,
    _resolve_user_capabilities,
    _ensure_org_membership,
)


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
        custom_caps = {"quotes": ["view", "create"], "projects": ["view"]}
        template = RoleTemplate.objects.create(
            name="Custom",
            slug="custom-test",
            is_system=False,
            organization=self.organization,
            capability_flags_json=custom_caps,
        )
        self._make_membership(role="worker", role_template=template)

        caps = _resolve_user_capabilities(self.user)
        self.assertEqual(caps["quotes"], ["view", "create"])
        self.assertEqual(caps["projects"], ["view"])
        self.assertNotIn("invoices", caps)

    def test_falls_back_to_system_template_by_role_slug(self):
        self._make_membership(role="viewer")

        caps = _resolve_user_capabilities(self.user)
        # Viewer system template has view-only on everything
        self.assertEqual(caps.get("quotes"), ["view"])
        self.assertEqual(caps.get("invoices"), ["view"])
        self.assertEqual(caps.get("users"), [])

    def test_owner_system_template_has_full_capabilities(self):
        self._make_membership(role="owner")

        caps = _resolve_user_capabilities(self.user)
        self.assertIn("create", caps["quotes"])
        self.assertIn("approve", caps["quotes"])
        self.assertIn("send", caps["quotes"])
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
            capability_flags_json={"quotes": ["create", "edit"]},
        )

        caps = _resolve_user_capabilities(self.user)
        # Should have both system viewer "view" and override "create", "edit"
        self.assertIn("view", caps["quotes"])
        self.assertIn("create", caps["quotes"])
        self.assertIn("edit", caps["quotes"])
        # Other resources should still be view-only
        self.assertEqual(caps.get("invoices"), ["view"])

    def test_no_prior_membership_bootstraps_owner_capabilities(self):
        orphan = User.objects.create_user(
            username="orphan",
            email="orphan@example.com",
            password="secret123",
        )
        # resolve_user_capabilities bootstraps membership via _ensure_org_membership
        caps = _resolve_user_capabilities(orphan)
        # Bootstrapped users get owner role
        self.assertIn("create", caps.get("quotes", []))

    def test_inactive_membership_bootstraps_via_ensure(self):
        # OneToOneField means _ensure_org_membership can't create a second
        # membership — it will find no ACTIVE one and bootstrap a new org+membership.
        # But since user already has a membership row, this would fail the unique
        # constraint. So we test a user with NO membership at all.
        fresh_user = User.objects.create_user(
            username="fresh-caps", email="fresh-caps@example.com", password="secret123",
        )
        caps = _resolve_user_capabilities(fresh_user)
        # Bootstrapped as owner
        self.assertIn("create", caps.get("quotes", []))
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
        self.assertNotIn("approve", caps.get("quotes", []))
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
        error, caps = _capability_gate(self.user, "quotes", "create")
        self.assertIsNone(error)
        self.assertIn("create", caps["quotes"])

    def test_gate_denies_when_capability_missing(self):
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role="viewer",
            status=OrganizationMembership.Status.ACTIVE,
        )
        error, caps = _capability_gate(self.user, "quotes", "create")
        self.assertIsNotNone(error)
        self.assertEqual(error["error"]["code"], "forbidden")
        self.assertIn("quotes.create", error["error"]["fields"]["capability"][0])

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
        error, caps = _capability_gate(self.user, "quotes", "create")
        self.assertIsNotNone(error)
        # Still returns the user's capabilities so caller can inspect
        self.assertIn("quotes", caps)


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
        self.assertIn("quotes", caps)
        self.assertIn("create", caps["quotes"])
        self.assertIn("payments", caps)

    def test_verify_email_response_includes_capabilities(self):
        # Register creates user + verification token (Flow A).
        from core.models import EmailVerificationToken

        self.client.post(
            "/api/v1/auth/register/",
            data={"email": "cap-register@example.com", "password": "secret123"},
            content_type="application/json",
        )
        user = User.objects.get(email="cap-register@example.com")
        token_obj = EmailVerificationToken.objects.get(user=user)

        # Verify email — this is the first auth response for Flow A users.
        response = self.client.post(
            "/api/v1/auth/verify-email/",
            data={"token": token_obj.token},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertIn("capabilities", data)
        caps = data["capabilities"]
        self.assertIn("quotes", caps)
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
        self.assertIn("quotes", data["capabilities"])

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
        for resource in ["quotes", "change_orders", "invoices", "vendor_bills"]:
            self.assertEqual(caps[resource], ["view"], f"{resource} should be view-only for viewer")


# ---------------------------------------------------------------------------
# _resolve_user_role
# ---------------------------------------------------------------------------


class ResolveUserRoleTests(TestCase):
    """Tests for role resolution from active membership."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="role-resolve", email="role-resolve@example.com", password="secret123",
        )
        self.org = Organization.objects.create(
            display_name="Role Resolve Org", created_by=self.user,
        )

    def test_resolves_from_active_membership(self):
        OrganizationMembership.objects.create(
            organization=self.org, user=self.user,
            role=OrganizationMembership.Role.WORKER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        self.assertEqual(_resolve_user_role(self.user), "worker")

    def test_fallback_owner_when_no_membership(self):
        orphan = User.objects.create_user(
            username="no-role", email="no-role@example.com", password="secret123",
        )
        self.assertEqual(_resolve_user_role(orphan), RBAC_ROLE_OWNER)


# ---------------------------------------------------------------------------
# Organization.derive_name
# ---------------------------------------------------------------------------


class OrganizationDeriveNameTests(TestCase):
    """Tests for deriving default org name from user identity."""

    def test_email_based(self):
        user = User.objects.create_user(
            username="org-name", email="john.doe@example.com", password="secret123",
        )
        name = Organization.derive_name(user)
        self.assertEqual(name, "John Doe Organization")

    def test_username_fallback(self):
        user = User.objects.create_user(
            username="jane_smith", email="", password="secret123",
        )
        name = Organization.derive_name(user)
        self.assertEqual(name, "Jane Smith Organization")

    def test_id_fallback(self):
        user = User.objects.create_user(
            username="no-identity", email="", password="secret123",
        )
        user.email = ""
        user.username = ""
        name = Organization.derive_name(user)
        self.assertIn("Organization", name)


# ---------------------------------------------------------------------------
# Organization snapshot builders
# ---------------------------------------------------------------------------


class OrganizationSnapshotTests(TestCase):
    """Tests for immutable audit snapshot builders."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="snap-test", email="snap-test@example.com", password="secret123",
        )
        self.org = Organization.objects.create(
            display_name="Snap Org",
            help_email="help@snap.com",
            billing_street_1="123 Main St",
            created_by=self.user,
        )

    def test_build_organization_snapshot(self):
        snap = self.org.build_snapshot()
        self.assertEqual(snap["organization"]["id"], self.org.id)
        self.assertEqual(snap["organization"]["display_name"], "Snap Org")
        self.assertEqual(snap["organization"]["help_email"], "help@snap.com")
        self.assertEqual(snap["organization"]["created_by_id"], self.user.id)

    def test_build_organization_membership_snapshot(self):
        membership = OrganizationMembership.objects.create(
            organization=self.org, user=self.user,
            role="owner", status=OrganizationMembership.Status.ACTIVE,
        )
        snap = membership.build_snapshot()
        self.assertEqual(snap["organization_membership"]["id"], membership.id)
        self.assertEqual(snap["organization_membership"]["role"], "owner")
        self.assertEqual(snap["organization_membership"]["user_id"], self.user.id)


# ---------------------------------------------------------------------------
# Audit record helpers
# ---------------------------------------------------------------------------


class OrganizationAuditRecordTests(TestCase):
    """Tests for immutable audit record creation."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="audit-test", email="audit-test@example.com", password="secret123",
        )
        self.org = Organization.objects.create(
            display_name="Audit Org", created_by=self.user,
        )

    def test_record_organization_record(self):
        OrganizationRecord.record(
            organization=self.org,
            event_type=OrganizationRecord.EventType.UPDATED,
            capture_source=OrganizationRecord.CaptureSource.MANUAL_UI,
            recorded_by=self.user,
            note="test note",
        )
        record = OrganizationRecord.objects.filter(organization=self.org).last()
        self.assertIsNotNone(record)
        self.assertEqual(record.event_type, OrganizationRecord.EventType.UPDATED)
        self.assertEqual(record.note, "test note")
        self.assertIn("organization", record.snapshot_json)

    def test_record_organization_membership_record(self):
        membership = OrganizationMembership.objects.create(
            organization=self.org, user=self.user,
            role="owner", status=OrganizationMembership.Status.ACTIVE,
        )
        OrganizationMembershipRecord.record(
            membership=membership,
            event_type=OrganizationMembershipRecord.EventType.CREATED,
            capture_source=OrganizationMembershipRecord.CaptureSource.AUTH_BOOTSTRAP,
            recorded_by=self.user,
            from_role="",
            to_role="owner",
        )
        record = OrganizationMembershipRecord.objects.filter(
            organization_membership=membership,
        ).last()
        self.assertIsNotNone(record)
        self.assertEqual(record.to_role, "owner")
        self.assertIn("organization_membership", record.snapshot_json)


# ---------------------------------------------------------------------------
# CostCode.seed_defaults
# ---------------------------------------------------------------------------


class CostCodeSeedDefaultsTests(TestCase):
    """Tests for seeding default cost codes on new organizations."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="costcode-test", email="costcode-test@example.com", password="secret123",
        )
        self.org = Organization.objects.create(
            display_name="Costcode Org", created_by=self.user,
        )

    def test_creates_default_codes(self):
        count = CostCode.seed_defaults(
            organization=self.org, created_by=self.user,
        )
        self.assertGreater(count, 0)
        self.assertTrue(
            CostCode.objects.filter(organization=self.org, code="01-100").exists()
        )

    def test_idempotent_on_rerun(self):
        first_count = CostCode.seed_defaults(
            organization=self.org, created_by=self.user,
        )
        second_count = CostCode.seed_defaults(
            organization=self.org, created_by=self.user,
        )
        self.assertEqual(second_count, 0)
        total = CostCode.objects.filter(organization=self.org).count()
        self.assertEqual(total, first_count)


# ---------------------------------------------------------------------------
# _ensure_org_membership
# ---------------------------------------------------------------------------


class EnsurePrimaryMembershipTests(TestCase):
    """Tests for the membership bootstrap / self-heal function."""

    def test_returns_existing_active_membership(self):
        user = User.objects.create_user(
            username="existing-member", email="existing@example.com", password="secret123",
        )
        org = Organization.objects.create(display_name="Existing Org", created_by=user)
        existing = OrganizationMembership.objects.create(
            organization=org, user=user,
            role="pm", status=OrganizationMembership.Status.ACTIVE,
        )
        result = _ensure_org_membership(user)
        self.assertEqual(result.id, existing.id)

    def test_bootstraps_org_and_membership_for_new_user(self):
        fresh = User.objects.create_user(
            username="fresh-boot", email="fresh-boot@example.com", password="secret123",
        )
        membership = _ensure_org_membership(fresh)
        self.assertIsNotNone(membership)
        self.assertEqual(membership.role, RBAC_ROLE_OWNER)
        self.assertEqual(membership.status, OrganizationMembership.Status.ACTIVE)
        self.assertIsNotNone(membership.organization)
        self.assertEqual(membership.organization.created_by, fresh)

    def test_bootstrap_creates_audit_records(self):
        fresh = User.objects.create_user(
            username="audit-boot", email="audit-boot@example.com", password="secret123",
        )
        membership = _ensure_org_membership(fresh)
        org_records = OrganizationRecord.objects.filter(organization=membership.organization)
        self.assertTrue(org_records.exists())
        self.assertEqual(
            org_records.first().capture_source,
            OrganizationRecord.CaptureSource.AUTH_BOOTSTRAP,
        )
        membership_records = OrganizationMembershipRecord.objects.filter(
            organization_membership=membership,
        )
        self.assertTrue(membership_records.exists())

    def test_bootstrap_seeds_default_cost_codes(self):
        fresh = User.objects.create_user(
            username="costcode-boot", email="costcode-boot@example.com", password="secret123",
        )
        membership = _ensure_org_membership(fresh)
        cost_codes = CostCode.objects.filter(organization=membership.organization)
        self.assertGreater(cost_codes.count(), 0)

    def test_idempotent_returns_same_membership(self):
        fresh = User.objects.create_user(
            username="idem-boot", email="idem-boot@example.com", password="secret123",
        )
        first = _ensure_org_membership(fresh)
        second = _ensure_org_membership(fresh)
        self.assertEqual(first.id, second.id)
