"use client";

/**
 * Organization settings console. Covers two concerns: editing the org profile
 * (identity, document presets for invoices/estimates/change orders) and managing
 * membership roles and statuses. Profile edits require owner or PM; membership
 * management is owner-only with self-edit protections.
 */

import { FormEvent, useEffect, useMemo, useState } from "react";

import shell from "@/shared/shell/page-shell.module.css";
import { buildAuthHeaders } from "@/features/session/auth-headers";
import { hasAnyRole } from "@/features/session/rbac";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { formatDateDisplay } from "@/shared/date-format";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { canDo } from "@/features/session/rbac";

import {
  ApiResponse,
  OrganizationInviteRecord,
  OrganizationMembershipRecord,
  OrganizationMembershipStatus,
  OrganizationProfile,
  OrganizationRolePolicy,
} from "../types";
import styles from "./organization-console.module.css";

type MembershipDraft = {
  role: string;
  status: OrganizationMembershipStatus;
};

type DocumentSettingsView = "invoice" | "estimate" | "change_order";

const FALLBACK_EDITABLE_ROLES = ["owner", "pm", "bookkeeping", "worker", "viewer"];
const FALLBACK_EDITABLE_STATUSES: OrganizationMembershipStatus[] = ["active", "disabled"];
const DOCUMENT_SETTINGS_OPTIONS: Array<{
  value: DocumentSettingsView;
  label: string;
  description: string;
}> = [
  {
    value: "invoice",
    label: "Invoices",
    description: "Prefill sender identity and billing template fields on new invoices.",
  },
  {
    value: "estimate",
    label: "Estimates",
    description: "Default terms and conditions applied to new estimates.",
  },
  {
    value: "change_order",
    label: "Change Orders",
    description: "Prefill default reasoning text on new change order drafts.",
  },
];

/** Convert a role slug to a human-readable label. */
function roleLabel(role: string): string {
  return role.replace("_", " ");
}

/** Convert a status slug to a human-readable label. */
function statusLabel(status: string): string {
  return status.replace("_", " ");
}

/** Snapshot current membership rows into a draft map for inline editing. */
function buildMembershipDrafts(
  rows: OrganizationMembershipRecord[],
): Record<number, MembershipDraft> {
  const next: Record<number, MembershipDraft> = {};
  for (const row of rows) {
    next[row.id] = { role: row.role, status: row.status };
  }
  return next;
}

/** Extract the most useful error string from an API response, falling back to a default. */
function extractErrorMessage(payload: ApiResponse | null, fallback: string): string {
  if (!payload?.error) {
    return fallback;
  }
  const fieldErrors = Object.values(payload.error.fields ?? {})
    .flat()
    .filter(Boolean)
    .join(" ");
  return payload.error.message || fieldErrors || fallback;
}

/** Organization profile editor and membership management console. */
export function OrganizationConsole() {
  const { token, role, capabilities, organization: sessionOrganization } = useSharedSessionAuth();
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const [errorMessage, setErrorMessage] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [savingMembershipId, setSavingMembershipId] = useState<number | null>(null);

  const [organizationProfile, setOrganizationProfile] = useState<OrganizationProfile | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembershipRecord[]>([]);
  const [rolePolicy, setRolePolicy] = useState<OrganizationRolePolicy | null>(null);
  const [activeMemberCount, setActiveMemberCount] = useState(0);

  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [logoUrlDraft, setLogoUrlDraft] = useState("");
  const [helpEmailDraft, setHelpEmailDraft] = useState("");
  const [billingAddressDraft, setBillingAddressDraft] = useState("");
  const [defaultInvoiceDueDeltaDraft, setDefaultInvoiceDueDeltaDraft] = useState("30");
  const [defaultEstimateValidDeltaDraft, setDefaultEstimateValidDeltaDraft] = useState("30");
  const [invoiceTermsDraft, setInvoiceTermsDraft] = useState("");
  const [estimateTermsDraft, setEstimateTermsDraft] = useState("");
  const [changeOrderTermsDraft, setChangeOrderTermsDraft] = useState("");
  const [membershipDrafts, setMembershipDrafts] = useState<Record<number, MembershipDraft>>({});
  const [documentSettingsView, setDocumentSettingsView] = useState<DocumentSettingsView>("invoice");

  // Invite state
  const [invites, setInvites] = useState<OrganizationInviteRecord[]>([]);
  const [inviteEmailDraft, setInviteEmailDraft] = useState("");
  const [inviteRoleDraft, setInviteRoleDraft] = useState("viewer");
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<number | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<number | null>(null);
  const [lastCreatedInviteToken, setLastCreatedInviteToken] = useState<string | null>(null);

  const canEditProfile =
    rolePolicy?.can_edit_profile ?? hasAnyRole(role, ["owner", "pm"]);
  const canManageMemberships =
    rolePolicy?.can_manage_memberships ?? hasAnyRole(role, ["owner"]);
  const canInvite =
    rolePolicy?.can_invite ?? canDo(capabilities, "users", "invite");
  const editableRoles = rolePolicy?.editable_roles ?? FALLBACK_EDITABLE_ROLES;
  const editableStatuses = rolePolicy?.editable_statuses ?? FALLBACK_EDITABLE_STATUSES;
  const hasSession = Boolean(token);
  const selectedDocumentSettings = DOCUMENT_SETTINGS_OPTIONS.find(
    (option) => option.value === documentSettingsView,
  ) ?? DOCUMENT_SETTINGS_OPTIONS[0];

  const profileChanged =
    organizationProfile !== null &&
    (displayNameDraft.trim() !== organizationProfile.display_name ||
      logoUrlDraft.trim() !== (organizationProfile.logo_url || "") ||
      helpEmailDraft.trim() !== (organizationProfile.help_email || "") ||
      billingAddressDraft.trim() !== (organizationProfile.billing_address || "") ||
      String(Number(defaultInvoiceDueDeltaDraft || "30")) !==
        String(organizationProfile.default_invoice_due_delta || 30) ||
      String(Number(defaultEstimateValidDeltaDraft || "30")) !==
        String(organizationProfile.default_estimate_valid_delta || 30) ||
      invoiceTermsDraft.trim() !== (organizationProfile.invoice_terms_and_conditions || "") ||
      estimateTermsDraft.trim() !== (organizationProfile.estimate_terms_and_conditions || "") ||
      changeOrderTermsDraft.trim() !== (organizationProfile.change_order_terms_and_conditions || ""));

  const activeMembersDerived = useMemo(
    () => memberships.filter((member) => member.status === "active").length,
    [memberships],
  );

  // Fetch org profile and memberships in parallel on mount
  useEffect(() => {
    if (!hasSession) {
      setErrorMessage("No session token found.");
      return;
    }

    let ignore = false;

    const loadData = async () => {
      setErrorMessage("");
      try {
        const [profileResponse, membershipsResponse, invitesResponse] = await Promise.all([
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
        const profilePayload: ApiResponse = await profileResponse.json();
        const membershipsPayload: ApiResponse = await membershipsResponse.json();
        if (ignore) {
          return;
        }
        if (!profileResponse.ok) {
          setErrorMessage(
            extractErrorMessage(profilePayload, "Could not load organization profile."),
          );
          return;
        }
        if (!membershipsResponse.ok) {
          setErrorMessage(
            extractErrorMessage(membershipsPayload, "Could not load organization memberships."),
          );
          return;
        }
        // Invites fetch is best-effort (user may not have users.invite capability)
        if (invitesResponse?.ok) {
          const invitesPayload = await invitesResponse.json();
          const invitesData = invitesPayload?.data as { invites?: OrganizationInviteRecord[] } | undefined;
          setInvites(invitesData?.invites ?? []);
        }

        const profileData = profilePayload.data as
          | {
              organization?: OrganizationProfile;
              active_member_count?: number;
              role_policy?: OrganizationRolePolicy;
            }
          | undefined;
        const membershipData = membershipsPayload.data as
          | {
              memberships?: OrganizationMembershipRecord[];
              role_policy?: OrganizationRolePolicy;
            }
          | undefined;
        const nextProfile = profileData?.organization ?? null;
        const nextMemberships = membershipData?.memberships ?? [];
        const nextRolePolicy = membershipData?.role_policy ?? profileData?.role_policy ?? null;
        if (!nextProfile) {
          setErrorMessage("Organization profile payload was empty.");
          return;
        }

        setOrganizationProfile(nextProfile);
        setDisplayNameDraft(nextProfile.display_name);
        setLogoUrlDraft(nextProfile.logo_url ?? "");
        setHelpEmailDraft(nextProfile.help_email ?? "");
        setBillingAddressDraft(nextProfile.billing_address ?? "");
        setDefaultInvoiceDueDeltaDraft(String(nextProfile.default_invoice_due_delta ?? 30));
        setDefaultEstimateValidDeltaDraft(String(nextProfile.default_estimate_valid_delta ?? 30));
        setInvoiceTermsDraft(nextProfile.invoice_terms_and_conditions ?? "");
        setEstimateTermsDraft(nextProfile.estimate_terms_and_conditions ?? "");
        setChangeOrderTermsDraft(nextProfile.change_order_terms_and_conditions ?? "");
        setMemberships(nextMemberships);
        setMembershipDrafts(buildMembershipDrafts(nextMemberships));
        setRolePolicy(nextRolePolicy);
        setActiveMemberCount(profileData?.active_member_count ?? nextMemberships.length);
      } catch {
        if (!ignore) {
          setErrorMessage("Could not reach organization endpoints.");
        }
      }
    };

    loadData();
    return () => {
      ignore = true;
    };
  }, [hasSession, normalizedBaseUrl, token]);

  /** PATCH the organization profile with all draft fields. */
  async function handleProfileSave(event: FormEvent) {
    event.preventDefault();
    if (!organizationProfile) {
      return;
    }
    if (!canEditProfile) {
      setErrorMessage("Your role cannot edit organization profile settings.");
      return;
    }
    if (!profileChanged) {
      return;
    }

    setIsSavingProfile(true);
    setErrorMessage("");

    // Clamp numeric fields to valid ranges before sending
    const parsedDueDelta = Number(defaultInvoiceDueDeltaDraft);
    const sanitizedDueDelta = Number.isFinite(parsedDueDelta)
      ? Math.max(1, Math.min(365, Math.round(parsedDueDelta)))
      : 30;
    const parsedEstimateDelta = Number(defaultEstimateValidDeltaDraft);
    const sanitizedEstimateDelta = Number.isFinite(parsedEstimateDelta)
      ? Math.max(1, Math.min(365, Math.round(parsedEstimateDelta)))
      : 30;
    const payload = {
      display_name: displayNameDraft.trim(),
      logo_url: logoUrlDraft.trim(),
      help_email: helpEmailDraft.trim(),
      billing_address: billingAddressDraft.trim(),
      default_invoice_due_delta: sanitizedDueDelta,
      default_estimate_valid_delta: sanitizedEstimateDelta,
      invoice_terms_and_conditions: invoiceTermsDraft.trim(),
      estimate_terms_and_conditions: estimateTermsDraft.trim(),
      change_order_terms_and_conditions: changeOrderTermsDraft.trim(),
    };
    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify(payload),
      });
      const body: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorMessage(extractErrorMessage(body, "Could not update organization profile."));
        return;
      }

      const data = body.data as
        | {
            organization?: OrganizationProfile;
            role_policy?: OrganizationRolePolicy;
          }
        | undefined;
      if (data?.organization) {
        setOrganizationProfile(data.organization);
        setDisplayNameDraft(data.organization.display_name);
        setLogoUrlDraft(data.organization.logo_url ?? "");
        setHelpEmailDraft(data.organization.help_email ?? "");
        setBillingAddressDraft(data.organization.billing_address ?? "");
        setDefaultInvoiceDueDeltaDraft(String(data.organization.default_invoice_due_delta ?? 30));
        setDefaultEstimateValidDeltaDraft(
          String(data.organization.default_estimate_valid_delta ?? 30),
        );
        setInvoiceTermsDraft(data.organization.invoice_terms_and_conditions ?? "");
        setEstimateTermsDraft(data.organization.estimate_terms_and_conditions ?? "");
        setChangeOrderTermsDraft(data.organization.change_order_terms_and_conditions ?? "");
      }
      if (data?.role_policy) {
        setRolePolicy(data.role_policy);
      }
    } catch {
      setErrorMessage("Could not reach organization profile update endpoint.");
    } finally {
      setIsSavingProfile(false);
    }
  }

  /** Update a single field in a membership draft without persisting to the server. */
  function updateMembershipDraft(
    membershipId: number,
    field: "role" | "status",
    value: string,
  ) {
    setMembershipDrafts((current) => ({
      ...current,
      [membershipId]: {
        ...(current[membershipId] ?? { role: "viewer", status: "active" }),
        [field]: value,
      },
    }));
  }

  /** PATCH a membership's role and/or status if they differ from the server state. */
  async function handleMembershipSave(row: OrganizationMembershipRecord) {
    if (!canManageMemberships) {
      setErrorMessage("Only owners can manage organization membership roles/status.");
      return;
    }

    const draft = membershipDrafts[row.id];
    if (!draft) {
      return;
    }
    // Only include fields that actually changed
    const patchPayload: Record<string, string> = {};
    if (draft.role !== row.role) {
      patchPayload.role = draft.role;
    }
    if (draft.status !== row.status) {
      patchPayload.status = draft.status;
    }
    if (Object.keys(patchPayload).length === 0) {
      return;
    }

    setSavingMembershipId(row.id);
    setErrorMessage("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/organization/memberships/${row.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify(patchPayload),
        },
      );
      const body: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorMessage(
          extractErrorMessage(body, `Could not update membership for ${row.user_email}.`),
        );
        return;
      }

      const data = body.data as
        | {
            membership?: OrganizationMembershipRecord;
            role_policy?: OrganizationRolePolicy;
          }
        | undefined;
      const updatedMembership = data?.membership;
      if (updatedMembership) {
        setMemberships((current) =>
          current.map((item) => (item.id === updatedMembership.id ? updatedMembership : item)),
        );
        setMembershipDrafts((current) => ({
          ...current,
          [updatedMembership.id]: {
            role: updatedMembership.role,
            status: updatedMembership.status,
          },
        }));
      }
      if (data?.role_policy) {
        setRolePolicy(data.role_policy);
      }
    } catch {
      setErrorMessage("Could not reach membership update endpoint.");
    } finally {
      setSavingMembershipId(null);
    }
  }

  /** Build an invite link from a token. */
  function buildInviteLink(inviteToken: string): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/register?token=${inviteToken}`;
  }

  /** POST a new invite. */
  async function handleCreateInvite(event: FormEvent) {
    event.preventDefault();
    if (!canInvite || isCreatingInvite) {
      return;
    }
    setIsCreatingInvite(true);
    setErrorMessage("");
    setLastCreatedInviteToken(null);
    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/invites/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ email: inviteEmailDraft.trim(), role: inviteRoleDraft }),
      });
      const body = await response.json();
      if (!response.ok) {
        setErrorMessage(extractErrorMessage(body, "Could not create invite."));
        return;
      }
      const invite = body?.data?.invite as OrganizationInviteRecord | undefined;
      if (invite) {
        setInvites((current) => [invite, ...current]);
        setLastCreatedInviteToken(invite.token);
        setInviteEmailDraft("");
        setInviteRoleDraft("viewer");
      }
    } catch {
      setErrorMessage("Could not reach invite endpoint.");
    } finally {
      setIsCreatingInvite(false);
    }
  }

  /** DELETE (revoke) a pending invite. */
  async function handleRevokeInvite(inviteId: number) {
    if (!canInvite) {
      return;
    }
    setRevokingInviteId(inviteId);
    setErrorMessage("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/invites/${inviteId}/`, {
        method: "DELETE",
        headers: buildAuthHeaders(token),
      });
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => null);
        setErrorMessage(extractErrorMessage(body, "Could not revoke invite."));
        return;
      }
      setInvites((current) => current.filter((inv) => inv.id !== inviteId));
      if (lastCreatedInviteToken) {
        const removedInvite = invites.find((inv) => inv.id === inviteId);
        if (removedInvite?.token === lastCreatedInviteToken) {
          setLastCreatedInviteToken(null);
        }
      }
    } catch {
      setErrorMessage("Could not reach invite revoke endpoint.");
    } finally {
      setRevokingInviteId(null);
    }
  }

  /** Copy an invite link to clipboard. */
  async function handleCopyInviteLink(invite: OrganizationInviteRecord) {
    try {
      await navigator.clipboard.writeText(buildInviteLink(invite.token));
      setCopiedInviteId(invite.id);
      setTimeout(() => setCopiedInviteId(null), 2000);
    } catch {
      // Fallback: select text in a temp input
      setErrorMessage("Could not copy to clipboard.");
    }
  }

  return (
    <div className={shell.page}>
      <main className={`${shell.main} ${shell.mainNarrow}`}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Ops / Meta</p>
            <h1 className={shell.title}>Organization & RBAC</h1>
            <p className={shell.copy}>
              Manage organization identity and membership roles from one page. Profile edits are
              `owner|pm`; membership role/status updates are owner-only.
            </p>
          </div>
          <div className={shell.heroMetaRow}>
            <span className={shell.metaPill}>
              Active Members: {activeMemberCount || activeMembersDerived}
            </span>
            <span className={shell.metaPill}>Current Role: {rolePolicy?.effective_role ?? role}</span>
            <span className={shell.metaPill}>
              Org: {sessionOrganization?.displayName || "n/a"}
            </span>
          </div>
        </header>

        {errorMessage ? (
          <section className={shell.card}>
            <p className={styles.errorText}>{errorMessage}</p>
          </section>
        ) : null}

        <section className={shell.card}>
          <h2 className={shell.sectionTitle}>Organization Profile</h2>
          <form className={styles.profileForm} onSubmit={handleProfileSave}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Display Name</span>
              <input
                value={displayNameDraft}
                onChange={(event) => setDisplayNameDraft(event.target.value)}
                disabled={!canEditProfile || isSavingProfile || !organizationProfile}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Logo URL</span>
              <input
                value={logoUrlDraft}
                onChange={(event) => setLogoUrlDraft(event.target.value)}
                placeholder="https://example.com/logo.png"
                disabled={!canEditProfile || isSavingProfile || !organizationProfile}
              />
            </label>
            <div className={styles.documentPresetHeader}>
              <div>
                <h3 className={styles.sectionSubTitle}>Document Presets</h3>
                <p className={styles.sectionSubCopy}>
                  Manage reusable defaults for invoices, estimates, and change orders in one place.
                </p>
              </div>
              <label className={`${styles.field} ${styles.documentTypeField}`}>
                <span className={styles.fieldLabel}>Document Type</span>
                <select
                  value={documentSettingsView}
                  onChange={(event) =>
                    setDocumentSettingsView(event.target.value as DocumentSettingsView)
                  }
                  disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                >
                  {DOCUMENT_SETTINGS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.documentPresetPanel}>
              <p className={styles.sectionSubCopy}>{selectedDocumentSettings.description}</p>
            </div>

            {documentSettingsView === "invoice" ? (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Help Email</span>
                  <input
                    value={helpEmailDraft}
                    onChange={(event) => setHelpEmailDraft(event.target.value)}
                    type="email"
                    placeholder="help@example.com"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Billing Address</span>
                  <textarea
                    value={billingAddressDraft}
                    onChange={(event) => setBillingAddressDraft(event.target.value)}
                    rows={3}
                    placeholder="Street, city, state, ZIP"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Default Due Days</span>
                  <input
                    value={defaultInvoiceDueDeltaDraft}
                    onChange={(event) => setDefaultInvoiceDueDeltaDraft(event.target.value)}
                    type="number"
                    min={1}
                    max={365}
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Invoice Terms & Conditions</span>
                  <textarea
                    value={invoiceTermsDraft}
                    onChange={(event) => setInvoiceTermsDraft(event.target.value)}
                    rows={3}
                    placeholder="Payment terms shown on invoice"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
              </>
            ) : null}

            {documentSettingsView === "estimate" ? (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Estimate Valid Days</span>
                  <input
                    value={defaultEstimateValidDeltaDraft}
                    onChange={(event) => setDefaultEstimateValidDeltaDraft(event.target.value)}
                    type="number"
                    min={1}
                    max={365}
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Estimate Terms & Conditions</span>
                  <textarea
                    value={estimateTermsDraft}
                    onChange={(event) => setEstimateTermsDraft(event.target.value)}
                    rows={4}
                    placeholder="Default terms and conditions shown on estimates"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
              </>
            ) : null}

            {documentSettingsView === "change_order" ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Change Order Terms & Conditions</span>
                <textarea
                  value={changeOrderTermsDraft}
                  onChange={(event) => setChangeOrderTermsDraft(event.target.value)}
                  rows={3}
                  placeholder="Default terms and conditions for change orders"
                  disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                />
              </label>
            ) : null}
            <div className={styles.profileMeta}>
              <span>
                Created:{" "}
                <strong>
                  {organizationProfile?.created_at
                    ? formatDateDisplay(organizationProfile.created_at)
                    : "n/a"}
                </strong>
              </span>
              <span>
                Last Updated:{" "}
                <strong>
                  {organizationProfile?.updated_at
                    ? formatDateDisplay(organizationProfile.updated_at)
                    : "n/a"}
                </strong>
              </span>
            </div>
            <div className={styles.profileActions}>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={!canEditProfile || isSavingProfile || !profileChanged}
              >
                {isSavingProfile ? "Saving..." : "Save Organization"}
              </button>
              {!canEditProfile ? (
                <span className={styles.permissionHint}>
                  Your role is read-only for organization profile settings.
                </span>
              ) : null}
            </div>
          </form>
        </section>

        <section className={shell.card}>
          <h2 className={shell.sectionTitle}>Memberships</h2>
          <p className={shell.sectionCopy}>
            Owner can update role and status. Self-role downgrade and self-disable are blocked for
            safety.
          </p>
          <div className={styles.membershipList}>
            {memberships.length === 0 ? (
              <p className={styles.emptyText}>No memberships found in this organization.</p>
            ) : null}
            {memberships.map((row) => {
              const draft = membershipDrafts[row.id] ?? { role: row.role, status: row.status };
              const changed = draft.role !== row.role || draft.status !== row.status;
              const rowIsSaving = savingMembershipId === row.id;
              const canEditRow = canManageMemberships && !row.is_current_user;
              return (
                <article key={row.id} className={styles.membershipRow}>
                  <div className={styles.memberIdentity}>
                    <p className={styles.memberName}>{row.user_full_name}</p>
                    <p className={styles.memberEmail}>{row.user_email}</p>
                    {row.is_current_user ? (
                      <span className={styles.selfBadge}>Current Session User</span>
                    ) : null}
                  </div>
                  <div className={styles.memberControls}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Role</span>
                      <select
                        value={draft.role}
                        onChange={(event) =>
                          updateMembershipDraft(row.id, "role", event.target.value)
                        }
                        disabled={!canEditRow || rowIsSaving}
                      >
                        {editableRoles.map((value) => (
                          <option key={value} value={value}>
                            {roleLabel(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Status</span>
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          updateMembershipDraft(row.id, "status", event.target.value)
                        }
                        disabled={!canEditRow || rowIsSaving}
                      >
                        {editableStatuses.map((value) => (
                          <option key={value} value={value}>
                            {statusLabel(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={styles.memberActions}>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => handleMembershipSave(row)}
                      disabled={!canEditRow || !changed || rowIsSaving}
                    >
                      {rowIsSaving ? "Saving..." : "Save Member"}
                    </button>
                    {!canManageMemberships ? (
                      <span className={styles.permissionHint}>Owner role required.</span>
                    ) : null}
                    {row.is_current_user ? (
                      <span className={styles.permissionHint}>
                        Update your own role/status from another owner account.
                      </span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {canInvite ? (
          <section className={shell.card}>
            <h2 className={shell.sectionTitle}>Invite Members</h2>
            <p className={shell.sectionCopy}>
              Create invite links to share with new or existing users. Links expire after 24 hours.
            </p>

            <form className={styles.inviteForm} onSubmit={handleCreateInvite}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Email</span>
                <input
                  type="email"
                  value={inviteEmailDraft}
                  onChange={(event) => setInviteEmailDraft(event.target.value)}
                  placeholder="teammate@example.com"
                  required
                  disabled={isCreatingInvite}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Role</span>
                <select
                  value={inviteRoleDraft}
                  onChange={(event) => setInviteRoleDraft(event.target.value)}
                  disabled={isCreatingInvite}
                >
                  {editableRoles.map((value) => (
                    <option key={value} value={value}>
                      {roleLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.inviteFormActions}>
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={isCreatingInvite || !inviteEmailDraft.trim()}
                >
                  {isCreatingInvite ? "Creating..." : "Create Invite"}
                </button>
              </div>
            </form>

            {lastCreatedInviteToken ? (
              <div className={styles.inviteLinkBanner}>
                <span className={styles.fieldLabel}>Invite Link (copy and share)</span>
                <div className={styles.inviteLinkRow}>
                  <code className={styles.inviteLinkCode}>
                    {buildInviteLink(lastCreatedInviteToken)}
                  </code>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => {
                      const invite = invites.find((inv) => inv.token === lastCreatedInviteToken);
                      if (invite) handleCopyInviteLink(invite);
                    }}
                  >
                    {copiedInviteId != null &&
                    invites.find((inv) => inv.token === lastCreatedInviteToken)?.id === copiedInviteId
                      ? "Copied!"
                      : "Copy"}
                  </button>
                </div>
              </div>
            ) : null}

            {invites.length > 0 ? (
              <div className={styles.inviteList}>
                <h3 className={styles.sectionSubTitle}>Pending Invites</h3>
                {invites.map((invite) => (
                  <article key={invite.id} className={styles.inviteRow}>
                    <div className={styles.inviteIdentity}>
                      <p className={styles.memberName}>{invite.email}</p>
                      <p className={styles.memberEmail}>
                        {roleLabel(invite.role)}
                        {invite.role_template_name ? ` (${invite.role_template_name})` : ""}
                        {" · "}Invited by {invite.invited_by_email}
                      </p>
                      <p className={styles.memberEmail}>
                        Expires {formatDateDisplay(invite.expires_at)}
                      </p>
                    </div>
                    <div className={styles.inviteActions}>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={() => handleCopyInviteLink(invite)}
                      >
                        {copiedInviteId === invite.id ? "Copied!" : "Copy Link"}
                      </button>
                      <button
                        className={`${styles.secondaryButton} ${styles.revokeButton}`}
                        type="button"
                        onClick={() => handleRevokeInvite(invite.id)}
                        disabled={revokingInviteId === invite.id}
                      >
                        {revokingInviteId === invite.id ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
