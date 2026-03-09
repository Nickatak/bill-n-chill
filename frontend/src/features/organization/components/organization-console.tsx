"use client";

/**
 * Organization console — slim orchestrator with 3-tab layout.
 *
 * Tab 1: My Business — identity fields (name, logo, phone, etc.)
 * Tab 2: My Team — memberships + invites
 * Tab 3: Document Settings — help email, due/valid deltas, T&Cs
 *
 * Fetches all data on mount, then passes props down to tab components.
 * URL stays at /ops/organization (no sub-routes).
 */

import { useEffect, useMemo, useState } from "react";

import shell from "@/shared/shell/page-shell.module.css";
import { PageShell, PageCard } from "@/shared/shell";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { loadClientSession, saveClientSession } from "@/shared/session/client-session";
import { hasAnyRole, canDo } from "@/shared/session/rbac";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import type {
  ApiResponse,
  OrganizationInviteRecord,
  OrganizationMembershipRecord,
  OrganizationMembershipStatus,
  OrganizationProfile,
  OrganizationRolePolicy,
} from "../types";
import { BusinessProfileTab } from "./business-profile-tab";
import { TeamTab } from "./team-tab";
import { DocumentSettingsTab } from "./document-settings-tab";
import styles from "./organization-console.module.css";

type OrgTab = "business" | "team" | "documents";

const TABS: Array<{ key: OrgTab; label: string }> = [
  { key: "business", label: "My Business" },
  { key: "team", label: "My Team" },
  { key: "documents", label: "Document Settings" },
];

const FALLBACK_EDITABLE_ROLES = ["owner", "pm", "bookkeeping", "worker", "viewer"];
const FALLBACK_EDITABLE_STATUSES: OrganizationMembershipStatus[] = ["active", "disabled"];

function extractErrorMessage(payload: ApiResponse | null, fallback: string): string {
  if (!payload?.error) return fallback;
  const fieldErrors = Object.values(payload.error.fields ?? {}).flat().filter(Boolean).join(" ");
  return payload.error.message || fieldErrors || fallback;
}

export function OrganizationConsole() {
  const { token, role, capabilities } = useSharedSessionAuth();
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const hasSession = Boolean(token);

  const [activeTab, setActiveTab] = useState<OrgTab>("business");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembershipRecord[]>([]);
  const [invites, setInvites] = useState<OrganizationInviteRecord[]>([]);
  const [rolePolicy, setRolePolicy] = useState<OrganizationRolePolicy | null>(null);
  const [activeMemberCount, setActiveMemberCount] = useState(0);

  const canEditProfile = rolePolicy?.can_edit_profile ?? hasAnyRole(role, ["owner", "pm"]);
  const canManageMemberships = rolePolicy?.can_manage_memberships ?? hasAnyRole(role, ["owner"]);
  const canInvite = rolePolicy?.can_invite ?? canDo(capabilities, "users", "invite");
  const editableRoles = rolePolicy?.editable_roles ?? FALLBACK_EDITABLE_ROLES;
  const editableStatuses = rolePolicy?.editable_statuses ?? FALLBACK_EDITABLE_STATUSES;

  const activeMembersDerived = useMemo(
    () => memberships.filter((m) => m.status === "active").length,
    [memberships],
  );

  // Mark the onboarding "org visited" step as complete on mount.
  useEffect(() => {
    localStorage.setItem("onboarding:org-visited", "1");
  }, []);

  // Fetch profile, memberships, and invites in parallel on mount
  useEffect(() => {
    if (!hasSession) {
      setErrorMessage("No session token found.");
      setLoading(false);
      return;
    }

    let ignore = false;

    async function loadData() {
      setErrorMessage("");
      try {
        const [profileRes, membershipsRes, invitesRes] = await Promise.all([
          fetch(`${normalizedBaseUrl}/organization/`, {
            headers: buildAuthHeaders(token),
          }),
          fetch(`${normalizedBaseUrl}/organization/memberships/`, {
            headers: buildAuthHeaders(token),
          }),
          fetch(`${normalizedBaseUrl}/organization/invites/`, {
            headers: buildAuthHeaders(token),
          }).catch(() => null),
        ]);

        const profilePayload: ApiResponse = await profileRes.json();
        const membershipsPayload: ApiResponse = await membershipsRes.json();

        if (ignore) return;

        if (!profileRes.ok) {
          setErrorMessage(extractErrorMessage(profilePayload, "Could not load organization profile."));
          return;
        }
        if (!membershipsRes.ok) {
          setErrorMessage(extractErrorMessage(membershipsPayload, "Could not load memberships."));
          return;
        }

        // Invites fetch is best-effort (user may lack users.invite capability)
        if (invitesRes?.ok) {
          const invitesPayload = await invitesRes.json();
          const invitesData = invitesPayload?.data as { invites?: OrganizationInviteRecord[] } | undefined;
          setInvites(invitesData?.invites ?? []);
        }

        const profileData = profilePayload.data as
          | { organization?: OrganizationProfile; active_member_count?: number; role_policy?: OrganizationRolePolicy }
          | undefined;
        const membershipData = membershipsPayload.data as
          | { memberships?: OrganizationMembershipRecord[]; role_policy?: OrganizationRolePolicy }
          | undefined;

        const nextProfile = profileData?.organization ?? null;
        const nextMemberships = membershipData?.memberships ?? [];
        const nextRolePolicy = membershipData?.role_policy ?? profileData?.role_policy ?? null;

        if (!nextProfile) {
          setErrorMessage("Organization profile payload was empty.");
          return;
        }

        setProfile(nextProfile);
        setMemberships(nextMemberships);
        setRolePolicy(nextRolePolicy);
        setActiveMemberCount(profileData?.active_member_count ?? nextMemberships.length);
      } catch {
        if (!ignore) {
          setErrorMessage("Could not reach organization endpoints.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadData();
    return () => { ignore = true; };
  }, [hasSession, normalizedBaseUrl, token]);

  function handleProfileUpdate(updatedProfile: OrganizationProfile, updatedPolicy?: OrganizationRolePolicy) {
    setProfile(updatedProfile);
    if (updatedPolicy) setRolePolicy(updatedPolicy);

    // Sync org name to session so the toolbar reflects the change immediately.
    const currentSession = loadClientSession();
    if (currentSession?.organization && updatedProfile.display_name !== currentSession.organization.displayName) {
      saveClientSession({
        ...currentSession,
        organization: { ...currentSession.organization, displayName: updatedProfile.display_name },
      });
    }
  }

  return (
    <PageShell narrow>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Business</p>
          <h1 className={shell.title}>Organization</h1>
          <p className={shell.copy}>
            Company identity, team membership, and document defaults.
          </p>
        </div>
        <div className={shell.heroMetaRow}>
          <span className={shell.metaPill}>
            Members: {activeMemberCount || activeMembersDerived}
          </span>
          <span className={shell.metaPill}>
            Role: {rolePolicy?.effective_role ?? role}
          </span>
        </div>
      </header>

      {errorMessage ? (
        <PageCard>
          <p className={styles.errorText}>{errorMessage}</p>
        </PageCard>
      ) : null}

      <PageCard>
        {/* Tab bar */}
        <div className={styles.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {loading ? (
          <p className={styles.loadingText}>Loading organization data&hellip;</p>
        ) : profile ? (
          <div className={styles.tabContent}>
            {activeTab === "business" ? (
              <BusinessProfileTab
                token={token}
                profile={profile}
                canEdit={canEditProfile}
                onProfileUpdate={handleProfileUpdate}
                onError={setErrorMessage}
              />
            ) : null}

            {activeTab === "team" ? (
              <TeamTab
                token={token}
                memberships={memberships}
                invites={invites}
                rolePolicy={rolePolicy}
                canManageMemberships={canManageMemberships}
                canInvite={canInvite}
                editableRoles={editableRoles}
                editableStatuses={editableStatuses}
                onMembershipsChange={setMemberships}
                onInvitesChange={setInvites}
                onRolePolicyChange={setRolePolicy}
                onError={setErrorMessage}
              />
            ) : null}

            {activeTab === "documents" ? (
              <DocumentSettingsTab
                token={token}
                profile={profile}
                canEdit={canEditProfile}
                onProfileUpdate={handleProfileUpdate}
                onError={setErrorMessage}
              />
            ) : null}
          </div>
        ) : null}
      </PageCard>
    </PageShell>
  );
}
