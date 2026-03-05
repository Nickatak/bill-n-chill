"""Tests for core.rbac — capability resolution, enforcement, and org bootstrap."""

from core.tests.common import *
from core.rbac import _capability_gate
from core.user_helpers import (
    RBAC_ROLE_OWNER,
    RBAC_ROLE_PM,
    RBAC_ROLE_BOOKKEEPING,
    RBAC_ROLE_WORKER,
    RBAC_ROLE_VIEWER,
    _resolve_user_role,
    _resolve_user_capabilities,
    _ensure_membership,
)


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
        self.assertEqual(_resolve_user_role(self.user), RBAC_ROLE_WORKER)

    def test_fallback_owner_when_no_membership(self):
        orphan = User.objects.create_user(
            username="no-role", email="no-role@example.com", password="secret123",
        )
        self.assertEqual(_resolve_user_role(orphan), RBAC_ROLE_OWNER)


# ---------------------------------------------------------------------------
# _resolve_user_capabilities
# ---------------------------------------------------------------------------


class ResolveUserCapabilitiesTests(TestCase):
    """Tests for capability resolution chain."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="caps-unit", email="caps-unit@example.com", password="secret123",
        )
        self.org = Organization.objects.create(
            display_name="Caps Unit Org", created_by=self.user,
        )

    def _make_membership(self, *, role="owner", role_template=None, capability_flags_json=None):
        return OrganizationMembership.objects.create(
            organization=self.org,
            user=self.user,
            role=role,
            status=OrganizationMembership.Status.ACTIVE,
            role_template=role_template,
            capability_flags_json=capability_flags_json or {},
        )

    def test_assigned_role_template_takes_precedence(self):
        template = RoleTemplate.objects.create(
            name="Custom", slug="custom-unit",
            is_system=False, organization=self.org,
            capability_flags_json={"estimates": ["view", "create"]},
        )
        self._make_membership(role="worker", role_template=template)
        caps = _resolve_user_capabilities(self.user)
        self.assertEqual(caps["estimates"], ["view", "create"])
        self.assertNotIn("invoices", caps)

    def test_falls_back_to_system_template(self):
        self._make_membership(role="viewer")
        caps = _resolve_user_capabilities(self.user)
        self.assertEqual(caps.get("estimates"), ["view"])

    def test_additive_overrides_merge(self):
        self._make_membership(
            role="viewer",
            capability_flags_json={"estimates": ["create", "edit"]},
        )
        caps = _resolve_user_capabilities(self.user)
        # System viewer gives "view", override adds "create" and "edit"
        self.assertIn("view", caps["estimates"])
        self.assertIn("create", caps["estimates"])
        self.assertIn("edit", caps["estimates"])

    def test_no_membership_bootstraps_owner(self):
        fresh = User.objects.create_user(
            username="fresh-cap", email="fresh-cap@example.com", password="secret123",
        )
        caps = _resolve_user_capabilities(fresh)
        self.assertIn("create", caps.get("estimates", []))

    def test_returns_empty_dict_when_no_template_and_no_system_match(self):
        # Create membership with a role slug that has no system template
        self._make_membership(role="nonexistent_role")
        caps = _resolve_user_capabilities(self.user)
        self.assertEqual(caps, {})


# ---------------------------------------------------------------------------
# _capability_gate
# ---------------------------------------------------------------------------


class CapabilityGateTests(TestCase):
    """Tests for the capability gate enforcement function."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="gate-unit", email="gate-unit@example.com", password="secret123",
        )
        self.org = Organization.objects.create(
            display_name="Gate Unit Org", created_by=self.user,
        )

    def test_allows_present_capability(self):
        OrganizationMembership.objects.create(
            organization=self.org, user=self.user,
            role="owner", status=OrganizationMembership.Status.ACTIVE,
        )
        error, caps = _capability_gate(self.user, "estimates", "create")
        self.assertIsNone(error)
        self.assertIn("create", caps["estimates"])

    def test_denies_missing_capability(self):
        OrganizationMembership.objects.create(
            organization=self.org, user=self.user,
            role="viewer", status=OrganizationMembership.Status.ACTIVE,
        )
        error, caps = _capability_gate(self.user, "estimates", "create")
        self.assertIsNotNone(error)
        self.assertEqual(error["error"]["code"], "forbidden")
        self.assertIn("estimates.create", error["error"]["fields"]["capability"][0])

    def test_denies_unknown_resource(self):
        OrganizationMembership.objects.create(
            organization=self.org, user=self.user,
            role="owner", status=OrganizationMembership.Status.ACTIVE,
        )
        error, _ = _capability_gate(self.user, "nonexistent", "edit")
        self.assertIsNotNone(error)

    def test_returns_capabilities_on_deny(self):
        OrganizationMembership.objects.create(
            organization=self.org, user=self.user,
            role="viewer", status=OrganizationMembership.Status.ACTIVE,
        )
        error, caps = _capability_gate(self.user, "estimates", "create")
        self.assertIsNotNone(error)
        self.assertIn("estimates", caps)


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
        # Simulate a user with no usable email — falls back to username seed
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
            billing_address="123 Main St",
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
# _ensure_membership
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
        result = _ensure_membership(user)
        self.assertEqual(result.id, existing.id)

    def test_bootstraps_org_and_membership_for_new_user(self):
        fresh = User.objects.create_user(
            username="fresh-boot", email="fresh-boot@example.com", password="secret123",
        )
        membership = _ensure_membership(fresh)
        self.assertIsNotNone(membership)
        self.assertEqual(membership.role, RBAC_ROLE_OWNER)
        self.assertEqual(membership.status, OrganizationMembership.Status.ACTIVE)
        # Org was created
        self.assertIsNotNone(membership.organization)
        self.assertEqual(membership.organization.created_by, fresh)

    def test_bootstrap_creates_audit_records(self):
        fresh = User.objects.create_user(
            username="audit-boot", email="audit-boot@example.com", password="secret123",
        )
        membership = _ensure_membership(fresh)
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
        membership = _ensure_membership(fresh)
        cost_codes = CostCode.objects.filter(organization=membership.organization)
        self.assertGreater(cost_codes.count(), 0)

    def test_idempotent_returns_same_membership(self):
        fresh = User.objects.create_user(
            username="idem-boot", email="idem-boot@example.com", password="secret123",
        )
        first = _ensure_membership(fresh)
        second = _ensure_membership(fresh)
        self.assertEqual(first.id, second.id)


