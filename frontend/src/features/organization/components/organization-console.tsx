"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import shell from "@/shared/shell/page-shell.module.css";
import { buildAuthHeaders } from "@/features/session/auth-headers";
import { hasAnyRole } from "@/features/session/rbac";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { formatDateDisplay } from "@/shared/date-format";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import {
  ApiResponse,
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

function roleLabel(role: string): string {
  return role.replace("_", " ");
}

function statusLabel(status: string): string {
  return status.replace("_", " ");
}

function buildMembershipDrafts(
  rows: OrganizationMembershipRecord[],
): Record<number, MembershipDraft> {
  const next: Record<number, MembershipDraft> = {};
  for (const row of rows) {
    next[row.id] = { role: row.role, status: row.status };
  }
  return next;
}

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

export function OrganizationConsole() {
  const { token, role, organization: sessionOrganization } = useSharedSessionAuth();
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const [errorMessage, setErrorMessage] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [savingMembershipId, setSavingMembershipId] = useState<number | null>(null);

  const [organizationProfile, setOrganizationProfile] = useState<OrganizationProfile | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembershipRecord[]>([]);
  const [rolePolicy, setRolePolicy] = useState<OrganizationRolePolicy | null>(null);
  const [activeMemberCount, setActiveMemberCount] = useState(0);

  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [logoUrlDraft, setLogoUrlDraft] = useState("");
  const [invoiceSenderNameDraft, setInvoiceSenderNameDraft] = useState("");
  const [invoiceSenderEmailDraft, setInvoiceSenderEmailDraft] = useState("");
  const [helpEmailDraft, setHelpEmailDraft] = useState("");
  const [invoiceSenderAddressDraft, setInvoiceSenderAddressDraft] = useState("");
  const [invoiceDefaultDueDaysDraft, setInvoiceDefaultDueDaysDraft] = useState("30");
  const [estimateValidationDeltaDaysDraft, setEstimateValidationDeltaDaysDraft] = useState("30");
  const [invoiceDefaultTermsDraft, setInvoiceDefaultTermsDraft] = useState("");
  const [estimateDefaultTermsDraft, setEstimateDefaultTermsDraft] = useState("");
  const [changeOrderDefaultReasonDraft, setChangeOrderDefaultReasonDraft] = useState("");
  const [invoiceDefaultFooterDraft, setInvoiceDefaultFooterDraft] = useState("");
  const [invoiceDefaultNotesDraft, setInvoiceDefaultNotesDraft] = useState("");
  const [membershipDrafts, setMembershipDrafts] = useState<Record<number, MembershipDraft>>({});
  const [documentSettingsView, setDocumentSettingsView] = useState<DocumentSettingsView>("invoice");

  const canEditProfile =
    rolePolicy?.can_edit_profile ?? hasAnyRole(role, ["owner", "pm"]);
  const canManageMemberships =
    rolePolicy?.can_manage_memberships ?? hasAnyRole(role, ["owner"]);
  const editableRoles = rolePolicy?.editable_roles ?? FALLBACK_EDITABLE_ROLES;
  const editableStatuses = rolePolicy?.editable_statuses ?? FALLBACK_EDITABLE_STATUSES;
  const hasSession = Boolean(token);
  const selectedDocumentSettings = DOCUMENT_SETTINGS_OPTIONS.find(
    (option) => option.value === documentSettingsView,
  ) ?? DOCUMENT_SETTINGS_OPTIONS[0];

  const profileChanged =
    organizationProfile !== null &&
    (displayNameDraft.trim() !== organizationProfile.display_name ||
      (slugDraft.trim() || "") !== (organizationProfile.slug || "") ||
      logoUrlDraft.trim() !== (organizationProfile.logo_url || "") ||
      invoiceSenderNameDraft.trim() !== (organizationProfile.invoice_sender_name || "") ||
      invoiceSenderEmailDraft.trim() !== (organizationProfile.invoice_sender_email || "") ||
      helpEmailDraft.trim() !== (organizationProfile.help_email || "") ||
      invoiceSenderAddressDraft.trim() !== (organizationProfile.invoice_sender_address || "") ||
      String(Number(invoiceDefaultDueDaysDraft || "30")) !==
        String(organizationProfile.invoice_default_due_days || 30) ||
      String(Number(estimateValidationDeltaDaysDraft || "30")) !==
        String(organizationProfile.estimate_validation_delta_days || 30) ||
      invoiceDefaultTermsDraft.trim() !== (organizationProfile.invoice_default_terms || "") ||
      estimateDefaultTermsDraft.trim() !== (organizationProfile.estimate_default_terms || "") ||
      changeOrderDefaultReasonDraft.trim() !==
        (organizationProfile.change_order_default_reason || "") ||
      invoiceDefaultFooterDraft.trim() !== (organizationProfile.invoice_default_footer || "") ||
      invoiceDefaultNotesDraft.trim() !== (organizationProfile.invoice_default_notes || ""));

  const activeMembersDerived = useMemo(
    () => memberships.filter((member) => member.status === "active").length,
    [memberships],
  );

  useEffect(() => {
    if (!hasSession) {
      setErrorMessage("No session token found.");
      return;
    }

    let ignore = false;

    const loadData = async () => {
      setErrorMessage("");
      try {
        const [profileResponse, membershipsResponse] = await Promise.all([
          fetch(`${normalizedBaseUrl}/organization/`, {
            headers: buildAuthHeaders(token),
          }),
          fetch(`${normalizedBaseUrl}/organization/memberships/`, {
            headers: buildAuthHeaders(token),
          }),
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
        setSlugDraft(nextProfile.slug ?? "");
        setLogoUrlDraft(nextProfile.logo_url ?? "");
        setInvoiceSenderNameDraft(nextProfile.invoice_sender_name ?? "");
        setInvoiceSenderEmailDraft(nextProfile.invoice_sender_email ?? "");
        setHelpEmailDraft(nextProfile.help_email ?? "");
        setInvoiceSenderAddressDraft(nextProfile.invoice_sender_address ?? "");
        setInvoiceDefaultDueDaysDraft(String(nextProfile.invoice_default_due_days ?? 30));
        setEstimateValidationDeltaDaysDraft(
          String(nextProfile.estimate_validation_delta_days ?? 30),
        );
        setInvoiceDefaultTermsDraft(nextProfile.invoice_default_terms ?? "");
        setEstimateDefaultTermsDraft(nextProfile.estimate_default_terms ?? "");
        setChangeOrderDefaultReasonDraft(nextProfile.change_order_default_reason ?? "");
        setInvoiceDefaultFooterDraft(nextProfile.invoice_default_footer ?? "");
        setInvoiceDefaultNotesDraft(nextProfile.invoice_default_notes ?? "");
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
    const parsedDueDays = Number(invoiceDefaultDueDaysDraft);
    const sanitizedDueDays = Number.isFinite(parsedDueDays)
      ? Math.max(1, Math.min(365, Math.round(parsedDueDays)))
      : 30;
    const parsedEstimateDeltaDays = Number(estimateValidationDeltaDaysDraft);
    const sanitizedEstimateDeltaDays = Number.isFinite(parsedEstimateDeltaDays)
      ? Math.max(1, Math.min(365, Math.round(parsedEstimateDeltaDays)))
      : 30;
    const payload = {
      display_name: displayNameDraft.trim(),
      slug: slugDraft.trim() || null,
      logo_url: logoUrlDraft.trim(),
      invoice_sender_name: invoiceSenderNameDraft.trim(),
      invoice_sender_email: invoiceSenderEmailDraft.trim(),
      help_email: helpEmailDraft.trim(),
      invoice_sender_address: invoiceSenderAddressDraft.trim(),
      invoice_default_due_days: sanitizedDueDays,
      estimate_validation_delta_days: sanitizedEstimateDeltaDays,
      invoice_default_terms: invoiceDefaultTermsDraft.trim(),
      estimate_default_terms: estimateDefaultTermsDraft.trim(),
      change_order_default_reason: changeOrderDefaultReasonDraft.trim(),
      invoice_default_footer: invoiceDefaultFooterDraft.trim(),
      invoice_default_notes: invoiceDefaultNotesDraft.trim(),
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
        setSlugDraft(data.organization.slug ?? "");
        setLogoUrlDraft(data.organization.logo_url ?? "");
        setInvoiceSenderNameDraft(data.organization.invoice_sender_name ?? "");
        setInvoiceSenderEmailDraft(data.organization.invoice_sender_email ?? "");
        setHelpEmailDraft(data.organization.help_email ?? "");
        setInvoiceSenderAddressDraft(data.organization.invoice_sender_address ?? "");
        setInvoiceDefaultDueDaysDraft(String(data.organization.invoice_default_due_days ?? 30));
        setEstimateValidationDeltaDaysDraft(
          String(data.organization.estimate_validation_delta_days ?? 30),
        );
        setInvoiceDefaultTermsDraft(data.organization.invoice_default_terms ?? "");
        setEstimateDefaultTermsDraft(data.organization.estimate_default_terms ?? "");
        setChangeOrderDefaultReasonDraft(data.organization.change_order_default_reason ?? "");
        setInvoiceDefaultFooterDraft(data.organization.invoice_default_footer ?? "");
        setInvoiceDefaultNotesDraft(data.organization.invoice_default_notes ?? "");
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

  async function handleMembershipSave(row: OrganizationMembershipRecord) {
    if (!canManageMemberships) {
      setErrorMessage("Only owners can manage organization membership roles/status.");
      return;
    }

    const draft = membershipDrafts[row.id];
    if (!draft) {
      return;
    }
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
              Org: {sessionOrganization?.displayName || sessionOrganization?.slug || "n/a"}
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
              <span className={styles.fieldLabel}>Slug</span>
              <input
                value={slugDraft}
                onChange={(event) => setSlugDraft(event.target.value)}
                placeholder="optional slug"
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
                  <span className={styles.fieldLabel}>Invoice Sender Name</span>
                  <input
                    value={invoiceSenderNameDraft}
                    onChange={(event) => setInvoiceSenderNameDraft(event.target.value)}
                    placeholder="Your company name"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Invoice Sender Email</span>
                  <input
                    value={invoiceSenderEmailDraft}
                    onChange={(event) => setInvoiceSenderEmailDraft(event.target.value)}
                    type="email"
                    placeholder="billing@example.com"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
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
                  <span className={styles.fieldLabel}>Invoice Sender Address</span>
                  <textarea
                    value={invoiceSenderAddressDraft}
                    onChange={(event) => setInvoiceSenderAddressDraft(event.target.value)}
                    rows={3}
                    placeholder="Street, city, state, ZIP"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Default Due Days</span>
                  <input
                    value={invoiceDefaultDueDaysDraft}
                    onChange={(event) => setInvoiceDefaultDueDaysDraft(event.target.value)}
                    type="number"
                    min={1}
                    max={365}
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Default Terms</span>
                  <textarea
                    value={invoiceDefaultTermsDraft}
                    onChange={(event) => setInvoiceDefaultTermsDraft(event.target.value)}
                    rows={3}
                    placeholder="Payment terms shown on invoice"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Default Footer</span>
                  <textarea
                    value={invoiceDefaultFooterDraft}
                    onChange={(event) => setInvoiceDefaultFooterDraft(event.target.value)}
                    rows={3}
                    placeholder="Footer line or compliance text"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Default Notes</span>
                  <textarea
                    value={invoiceDefaultNotesDraft}
                    onChange={(event) => setInvoiceDefaultNotesDraft(event.target.value)}
                    rows={3}
                    placeholder="Optional notes to prefill on new invoices"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
              </>
            ) : null}

            {documentSettingsView === "estimate" ? (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Estimate Validation Delta (Days)</span>
                  <input
                    value={estimateValidationDeltaDaysDraft}
                    onChange={(event) => setEstimateValidationDeltaDaysDraft(event.target.value)}
                    type="number"
                    min={1}
                    max={365}
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Estimate Terms & Conditions</span>
                  <textarea
                    value={estimateDefaultTermsDraft}
                    onChange={(event) => setEstimateDefaultTermsDraft(event.target.value)}
                    rows={4}
                    placeholder="Default terms and conditions shown on estimates"
                    disabled={!canEditProfile || isSavingProfile || !organizationProfile}
                  />
                </label>
              </>
            ) : null}

            {documentSettingsView === "change_order" ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Default Change Order Reason</span>
                <textarea
                  value={changeOrderDefaultReasonDraft}
                  onChange={(event) => setChangeOrderDefaultReasonDraft(event.target.value)}
                  rows={3}
                  placeholder="Default reason for scope/price/schedule adjustment requests"
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
      </main>
    </div>
  );
}
