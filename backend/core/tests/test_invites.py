"""Tests for RBAC Phase 4: Invite Flow (create, list, revoke, verify, Flow B, Flow C)."""

from datetime import timedelta

from django.utils import timezone

from core.tests.common import *


class InviteTestMixin:
    """Shared setup for invite tests: org + owner + seeded role templates."""

    def setUp(self):
        super().setUp()
        # Create owner user + org + membership
        self.owner = User.objects.create_user(
            username="owner@test.com", email="owner@test.com", password="secret123"
        )
        self.organization = Organization.objects.create(
            display_name="Test Org", created_by=self.owner
        )
        self.owner_membership = OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.owner,
            role=OrganizationMembership.Role.OWNER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        self.owner_token, _ = Token.objects.get_or_create(user=self.owner)

        # System role templates are seeded by migration 0002.
        # Fetch them for reference — they already have users.invite for owner + pm.
        self.owner_template = RoleTemplate.objects.get(slug="owner", is_system=True)
        self.pm_template = RoleTemplate.objects.get(slug="pm", is_system=True)

    def _auth(self, token_obj):
        return {"HTTP_AUTHORIZATION": f"Token {token_obj.key}"}

    def _create_invite(self, email="invitee@test.com", role="viewer", token_obj=None):
        return self.client.post(
            "/api/v1/organization/invites/",
            data={"email": email, "role": role},
            content_type="application/json",
            **(self._auth(token_obj or self.owner_token)),
        )


class InviteCRUDTests(InviteTestMixin, TestCase):
    """Tests for creating, listing, and revoking invites."""

    def test_owner_can_create_invite(self):
        response = self._create_invite()
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]["invite"]
        self.assertEqual(data["email"], "invitee@test.com")
        self.assertEqual(data["role"], "viewer")
        self.assertTrue(data["token"])
        self.assertEqual(data["invited_by_email"], "owner@test.com")
        self.assertEqual(OrganizationInvite.objects.count(), 1)

    def test_pm_can_create_invite(self):
        pm_user = User.objects.create_user(
            username="pm@test.com", email="pm@test.com", password="secret123"
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=pm_user,
            role=OrganizationMembership.Role.PM,
            status=OrganizationMembership.Status.ACTIVE,
        )
        pm_token, _ = Token.objects.get_or_create(user=pm_user)
        response = self._create_invite(email="pm-invite@test.com", token_obj=pm_token)
        self.assertEqual(response.status_code, 201)

    def test_worker_cannot_create_invite(self):
        worker = User.objects.create_user(
            username="worker@test.com", email="worker@test.com", password="secret123"
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=worker,
            role=OrganizationMembership.Role.WORKER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        worker_token, _ = Token.objects.get_or_create(user=worker)
        response = self._create_invite(token_obj=worker_token)
        self.assertEqual(response.status_code, 403)

    def test_viewer_cannot_create_invite(self):
        viewer = User.objects.create_user(
            username="viewer@test.com", email="viewer@test.com", password="secret123"
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=viewer,
            role=OrganizationMembership.Role.VIEWER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        viewer_token, _ = Token.objects.get_or_create(user=viewer)
        response = self._create_invite(token_obj=viewer_token)
        self.assertEqual(response.status_code, 403)

    def test_duplicate_invite_returns_409(self):
        self._create_invite(email="dup@test.com")
        response = self._create_invite(email="dup@test.com")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "conflict")

    def test_list_returns_only_pending_invites(self):
        self._create_invite(email="active@test.com")
        # Create expired invite directly
        OrganizationInvite(
            organization=self.organization, email="expired@test.com",
            role="viewer", invited_by=self.owner,
            expires_at=timezone.now() - timedelta(hours=1),
        ).save()
        # Create consumed invite
        consumed = OrganizationInvite(
            organization=self.organization, email="consumed@test.com",
            role="viewer", invited_by=self.owner,
        )
        consumed.save()
        consumed.consumed_at = timezone.now()
        consumed.save(update_fields=["consumed_at"])

        response = self.client.get(
            "/api/v1/organization/invites/",
            **self._auth(self.owner_token),
        )
        self.assertEqual(response.status_code, 200)
        invites = response.json()["data"]["invites"]
        self.assertEqual(len(invites), 1)
        self.assertEqual(invites[0]["email"], "active@test.com")

    def test_revoke_invite(self):
        create_resp = self._create_invite()
        invite_id = create_resp.json()["data"]["invite"]["id"]

        response = self.client.delete(
            f"/api/v1/organization/invites/{invite_id}/",
            **self._auth(self.owner_token),
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(OrganizationInvite.objects.count(), 0)

    def test_revoke_cross_org_returns_404(self):
        # Create invite in org A
        create_resp = self._create_invite()
        invite_id = create_resp.json()["data"]["invite"]["id"]

        # Create org B with different owner
        other_owner = User.objects.create_user(
            username="other@test.com", email="other@test.com", password="secret123"
        )
        other_org = Organization.objects.create(
            display_name="Other Org", created_by=other_owner
        )
        OrganizationMembership.objects.create(
            organization=other_org, user=other_owner,
            role=OrganizationMembership.Role.OWNER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        other_token, _ = Token.objects.get_or_create(user=other_owner)

        response = self.client.delete(
            f"/api/v1/organization/invites/{invite_id}/",
            **self._auth(other_token),
        )
        self.assertEqual(response.status_code, 404)


class VerifyInviteTests(InviteTestMixin, TestCase):
    """Tests for the verify-invite endpoint."""

    def test_verify_valid_invite_new_user(self):
        create_resp = self._create_invite(email="new@test.com")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.get(f"/api/v1/auth/verify-invite/{token_str}/")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["organization_name"], "Test Org")
        self.assertEqual(data["email"], "new@test.com")
        self.assertEqual(data["role"], "viewer")
        self.assertFalse(data["is_existing_user"])

    def test_verify_valid_invite_existing_user(self):
        User.objects.create_user(
            username="existing@test.com", email="existing@test.com", password="secret123"
        )
        create_resp = self._create_invite(email="existing@test.com")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.get(f"/api/v1/auth/verify-invite/{token_str}/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["data"]["is_existing_user"])

    def test_verify_expired_invite(self):
        invite = OrganizationInvite(
            organization=self.organization, email="expired@test.com",
            role="viewer", invited_by=self.owner,
            expires_at=timezone.now() - timedelta(hours=1),
        )
        invite.save()

        response = self.client.get(f"/api/v1/auth/verify-invite/{invite.token}/")
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["error"]["code"], "expired")

    def test_verify_consumed_invite(self):
        invite = OrganizationInvite(
            organization=self.organization, email="consumed@test.com",
            role="viewer", invited_by=self.owner,
        )
        invite.save()
        invite.consumed_at = timezone.now()
        invite.save(update_fields=["consumed_at"])

        response = self.client.get(f"/api/v1/auth/verify-invite/{invite.token}/")
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["error"]["code"], "consumed")

    def test_verify_invalid_token(self):
        response = self.client.get("/api/v1/auth/verify-invite/nonexistent-token/")
        self.assertEqual(response.status_code, 404)


class CheckInviteByEmailTests(InviteTestMixin, TestCase):
    """Tests for the check-invite-by-email endpoint (auto-detect pending invites)."""

    def test_check_invite_returns_pending_invite(self):
        self._create_invite(email="pending@test.com", role="pm")

        response = self.client.get("/api/v1/auth/check-invite/?email=pending@test.com")
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["organization_name"], "Test Org")
        self.assertEqual(data["role"], "pm")
        self.assertTrue(data["invite_token"])

    def test_check_invite_case_insensitive(self):
        self._create_invite(email="CasE@test.com")

        response = self.client.get("/api/v1/auth/check-invite/?email=case@test.com")
        self.assertEqual(response.status_code, 200)

    def test_check_invite_no_pending_returns_404(self):
        response = self.client.get("/api/v1/auth/check-invite/?email=nobody@test.com")
        self.assertEqual(response.status_code, 404)

    def test_check_invite_expired_not_returned(self):
        OrganizationInvite(
            organization=self.organization, email="expired@test.com",
            role="viewer", invited_by=self.owner,
            expires_at=timezone.now() - timedelta(hours=1),
        ).save()

        response = self.client.get("/api/v1/auth/check-invite/?email=expired@test.com")
        self.assertEqual(response.status_code, 404)

    def test_check_invite_consumed_not_returned(self):
        invite = OrganizationInvite(
            organization=self.organization, email="consumed@test.com",
            role="viewer", invited_by=self.owner,
        )
        invite.save()
        invite.consumed_at = timezone.now()
        invite.save(update_fields=["consumed_at"])

        response = self.client.get("/api/v1/auth/check-invite/?email=consumed@test.com")
        self.assertEqual(response.status_code, 404)

    def test_check_invite_missing_email_returns_400(self):
        response = self.client.get("/api/v1/auth/check-invite/")
        self.assertEqual(response.status_code, 400)


class FlowBTests(InviteTestMixin, TestCase):
    """Tests for Flow B: new user registering with invite token."""

    def test_register_with_invite_joins_org(self):
        create_resp = self._create_invite(email="newbie@test.com", role="pm")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "newbie@test.com", "password": "secret123", "invite_token": token_str},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()["data"]
        self.assertTrue(data["token"])
        self.assertEqual(data["organization"]["id"], self.organization.id)
        self.assertEqual(data["organization"]["display_name"], "Test Org")

        # Verify membership
        new_user = User.objects.get(email="newbie@test.com")
        membership = OrganizationMembership.objects.get(user=new_user)
        self.assertEqual(membership.organization_id, self.organization.id)
        self.assertEqual(membership.role, OrganizationMembership.Role.PM)
        self.assertEqual(membership.status, OrganizationMembership.Status.ACTIVE)

        # Invite consumed
        invite = OrganizationInvite.objects.get(token=token_str)
        self.assertIsNotNone(invite.consumed_at)

        # Audit record created
        records = OrganizationMembershipRecord.objects.filter(organization_membership=membership)
        self.assertEqual(records.count(), 1)
        self.assertEqual(records.first().event_type, OrganizationMembershipRecord.EventType.CREATED)

    def test_register_with_invite_email_mismatch_rejected(self):
        create_resp = self._create_invite(email="specific@test.com")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "different@test.com", "password": "secret123", "invite_token": token_str},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("match", response.json()["error"]["message"].lower())

    def test_register_with_expired_invite_rejected(self):
        invite = OrganizationInvite(
            organization=self.organization, email="late@test.com",
            role="viewer", invited_by=self.owner,
            expires_at=timezone.now() - timedelta(hours=1),
        )
        invite.save()

        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "late@test.com", "password": "secret123", "invite_token": invite.token},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_register_with_consumed_invite_rejected(self):
        invite = OrganizationInvite(
            organization=self.organization, email="used@test.com",
            role="viewer", invited_by=self.owner,
        )
        invite.save()
        invite.consumed_at = timezone.now()
        invite.save(update_fields=["consumed_at"])

        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "used@test.com", "password": "secret123", "invite_token": invite.token},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_register_without_invite_unchanged(self):
        """Regression: Flow A still works when no invite_token is provided."""
        response = self.client.post(
            "/api/v1/auth/register/",
            data={"email": "regular@test.com", "password": "secret123"},
            content_type="application/json",
        )
        # Flow A now returns 200 with "check your email" (email verification).
        self.assertEqual(response.status_code, 200)
        self.assertIn("message", response.json()["data"])

        # User created in a NEW org (not self.organization).
        new_user = User.objects.get(email="regular@test.com")
        membership = OrganizationMembership.objects.get(user=new_user)
        self.assertNotEqual(membership.organization_id, self.organization.id)
        self.assertEqual(membership.role, OrganizationMembership.Role.OWNER)


class FlowCTests(InviteTestMixin, TestCase):
    """Tests for Flow C: existing user accepting invite (org-switch with password confirmation)."""

    def setUp(self):
        super().setUp()
        # Create existing user in a different org
        self.existing_user = User.objects.create_user(
            username="existing@test.com", email="existing@test.com", password="secret123"
        )
        self.other_org = Organization.objects.create(
            display_name="Other Org", created_by=self.existing_user
        )
        self.existing_membership = OrganizationMembership.objects.create(
            organization=self.other_org, user=self.existing_user,
            role=OrganizationMembership.Role.OWNER,
            status=OrganizationMembership.Status.ACTIVE,
        )

    def test_accept_invite_moves_membership(self):
        create_resp = self._create_invite(email="existing@test.com", role="pm")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.post(
            "/api/v1/auth/accept-invite/",
            data={"invite_token": token_str, "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()["data"]
        self.assertEqual(data["organization"]["id"], self.organization.id)
        self.assertEqual(data["organization"]["display_name"], "Test Org")

        # Membership moved
        self.existing_membership.refresh_from_db()
        self.assertEqual(self.existing_membership.organization_id, self.organization.id)
        self.assertEqual(self.existing_membership.role, OrganizationMembership.Role.PM)

        # Invite consumed
        invite = OrganizationInvite.objects.get(token=token_str)
        self.assertIsNotNone(invite.consumed_at)

        # Audit record with previous org metadata
        records = OrganizationMembershipRecord.objects.filter(
            organization_membership=self.existing_membership
        )
        self.assertTrue(records.exists())
        last_record = records.order_by("-id").first()
        self.assertEqual(last_record.event_type, OrganizationMembershipRecord.EventType.ROLE_CHANGED)
        self.assertEqual(last_record.metadata_json["previous_organization_id"], self.other_org.id)

    def test_accept_invite_wrong_password_rejected(self):
        create_resp = self._create_invite(email="existing@test.com")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.post(
            "/api/v1/auth/accept-invite/",
            data={"invite_token": token_str, "password": "wrongpassword"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "invalid_credentials")

    def test_accept_invite_already_in_target_org_idempotent(self):
        # Create invite for user who is already in the target org
        create_resp = self._create_invite(email="owner@test.com")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.post(
            "/api/v1/auth/accept-invite/",
            data={"invite_token": token_str, "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        # Membership unchanged
        self.owner_membership.refresh_from_db()
        self.assertEqual(self.owner_membership.organization_id, self.organization.id)
        self.assertEqual(self.owner_membership.role, OrganizationMembership.Role.OWNER)

        # Invite still consumed
        invite = OrganizationInvite.objects.get(token=token_str)
        self.assertIsNotNone(invite.consumed_at)

    def test_accept_invite_expired_rejected(self):
        invite = OrganizationInvite(
            organization=self.organization, email="existing@test.com",
            role="viewer", invited_by=self.owner,
            expires_at=timezone.now() - timedelta(hours=1),
        )
        invite.save()

        response = self.client.post(
            "/api/v1/auth/accept-invite/",
            data={"invite_token": invite.token, "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 410)

    def test_accept_invite_missing_fields(self):
        response = self.client.post(
            "/api/v1/auth/accept-invite/",
            data={},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_accept_invite_nonexistent_user(self):
        create_resp = self._create_invite(email="ghost@test.com")
        token_str = create_resp.json()["data"]["invite"]["token"]

        response = self.client.post(
            "/api/v1/auth/accept-invite/",
            data={"invite_token": token_str, "password": "secret123"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)


class RolePolicyInviteTests(InviteTestMixin, TestCase):
    """Tests for can_invite in role_policy response."""

    def test_owner_role_policy_includes_can_invite(self):
        response = self.client.get(
            "/api/v1/organization/",
            **self._auth(self.owner_token),
        )
        self.assertEqual(response.status_code, 200)
        policy = response.json()["data"]["role_policy"]
        self.assertTrue(policy["can_invite"])

    def test_worker_role_policy_can_invite_false(self):
        worker = User.objects.create_user(
            username="w@test.com", email="w@test.com", password="secret123"
        )
        OrganizationMembership.objects.create(
            organization=self.organization, user=worker,
            role=OrganizationMembership.Role.WORKER,
            status=OrganizationMembership.Status.ACTIVE,
        )
        worker_token, _ = Token.objects.get_or_create(user=worker)

        response = self.client.get(
            "/api/v1/organization/",
            **self._auth(worker_token),
        )
        self.assertEqual(response.status_code, 200)
        policy = response.json()["data"]["role_policy"]
        self.assertFalse(policy["can_invite"])
