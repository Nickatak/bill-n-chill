"use client";

/**
 * "My Team" tab — membership management + invite creation.
 * Merges what were separate "Memberships" and "Invite Members" sections
 * into a single tab: "who works here and how do I add more people."
 */

import { FormEvent, useState } from "react";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { formatDateTimeDisplay } from "@/shared/date-format";
import { normalizeApiBaseUrl, defaultApiBaseUrl } from "../api";
import type {
  ApiResponse,
  OrganizationInviteRecord,
  OrganizationMembershipRecord,
  OrganizationMembershipStatus,
  OrganizationRolePolicy,
} from "../types";
import styles from "./organization-console.module.css";

type MembershipDraft = {
  role: string;
  status: OrganizationMembershipStatus;
};

type TeamTabProps = {
  token: string;
  memberships: OrganizationMembershipRecord[];
  invites: OrganizationInviteRecord[];
  rolePolicy: OrganizationRolePolicy | null;
  canManageMemberships: boolean;
  canInvite: boolean;
  editableRoles: string[];
  editableStatuses: OrganizationMembershipStatus[];
  onMembershipsChange: (memberships: OrganizationMembershipRecord[]) => void;
  onInvitesChange: (invites: OrganizationInviteRecord[]) => void;
  onRolePolicyChange: (rolePolicy: OrganizationRolePolicy) => void;
  onError: (message: string) => void;
};

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
  if (!payload?.error) return fallback;
  const fieldErrors = Object.values(payload.error.fields ?? {}).flat().filter(Boolean).join(" ");
  return payload.error.message || fieldErrors || fallback;
}

function buildInviteLink(inviteToken: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/register?token=${inviteToken}`;
}

export function TeamTab({
  token,
  memberships,
  invites,
  canManageMemberships,
  canInvite,
  editableRoles,
  editableStatuses,
  onMembershipsChange,
  onInvitesChange,
  onRolePolicyChange,
  onError,
}: TeamTabProps) {
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  // Membership editing
  const [membershipDrafts, setMembershipDrafts] = useState<Record<number, MembershipDraft>>(
    () => buildMembershipDrafts(memberships),
  );
  const [savingMembershipId, setSavingMembershipId] = useState<number | null>(null);

  // Invite state
  const [inviteEmailDraft, setInviteEmailDraft] = useState("");
  const [inviteRoleDraft, setInviteRoleDraft] = useState("viewer");
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<number | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<number | null>(null);
  const [lastCreatedInviteToken, setLastCreatedInviteToken] = useState<string | null>(null);

  function updateMembershipDraft(membershipId: number, field: "role" | "status", value: string) {
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
      onError("Only owners can manage organization membership roles/status.");
      return;
    }

    const draft = membershipDrafts[row.id];
    if (!draft) return;

    const patchPayload: Record<string, string> = {};
    if (draft.role !== row.role) patchPayload.role = draft.role;
    if (draft.status !== row.status) patchPayload.status = draft.status;
    if (Object.keys(patchPayload).length === 0) return;

    setSavingMembershipId(row.id);
    onError("");

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
        onError(extractErrorMessage(body, `Could not update membership for ${row.user_email}.`));
        return;
      }

      const data = body.data as
        | { membership?: OrganizationMembershipRecord; role_policy?: OrganizationRolePolicy }
        | undefined;
      if (data?.membership) {
        const updated = data.membership;
        onMembershipsChange(
          memberships.map((item) => (item.id === updated.id ? updated : item)),
        );
        setMembershipDrafts((current) => ({
          ...current,
          [updated.id]: { role: updated.role, status: updated.status },
        }));
      }
      if (data?.role_policy) onRolePolicyChange(data.role_policy);
    } catch {
      onError("Could not reach membership update endpoint.");
    } finally {
      setSavingMembershipId(null);
    }
  }

  async function handleCreateInvite(event: FormEvent) {
    event.preventDefault();
    if (!canInvite || isCreatingInvite) return;

    setIsCreatingInvite(true);
    onError("");
    setLastCreatedInviteToken(null);

    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/invites/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ email: inviteEmailDraft.trim(), role: inviteRoleDraft }),
      });
      const body = await response.json();
      if (!response.ok) {
        onError(extractErrorMessage(body, "Could not create invite."));
        return;
      }
      const invite = body?.data?.invite as OrganizationInviteRecord | undefined;
      if (invite) {
        onInvitesChange([invite, ...invites]);
        setLastCreatedInviteToken(invite.token);
        setInviteEmailDraft("");
        setInviteRoleDraft("viewer");
      }
    } catch {
      onError("Could not reach invite endpoint.");
    } finally {
      setIsCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: number) {
    if (!canInvite) return;
    setRevokingInviteId(inviteId);
    onError("");

    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/invites/${inviteId}/`, {
        method: "DELETE",
        headers: buildAuthHeaders(token),
      });
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => null);
        onError(extractErrorMessage(body, "Could not revoke invite."));
        return;
      }
      const nextInvites = invites.filter((inv) => inv.id !== inviteId);
      onInvitesChange(nextInvites);
      if (lastCreatedInviteToken) {
        const removedInvite = invites.find((inv) => inv.id === inviteId);
        if (removedInvite?.token === lastCreatedInviteToken) {
          setLastCreatedInviteToken(null);
        }
      }
    } catch {
      onError("Could not reach invite revoke endpoint.");
    } finally {
      setRevokingInviteId(null);
    }
  }

  async function handleCopyInviteLink(invite: OrganizationInviteRecord) {
    try {
      await navigator.clipboard.writeText(buildInviteLink(invite.token));
      setCopiedInviteId(invite.id);
      setTimeout(() => setCopiedInviteId(null), 2000);
    } catch {
      onError("Could not copy to clipboard.");
    }
  }

  return (
    <div className={styles.teamTab}>
      {/* ── Memberships ── */}
      {memberships.length === 0 ? (
        <p className={styles.emptyText}>No memberships found in this organization.</p>
      ) : (
        <table className={styles.memberTable}>
          <thead>
            <tr>
              <th className={styles.memberTh}>Member</th>
              <th className={styles.memberTh}>Role</th>
              <th className={styles.memberTh}>Status</th>
              {canManageMemberships ? <th className={styles.memberTh} /> : null}
            </tr>
          </thead>
          <tbody>
            {memberships.map((row) => {
              const draft = membershipDrafts[row.id] ?? { role: row.role, status: row.status };
              const changed = draft.role !== row.role || draft.status !== row.status;
              const rowIsSaving = savingMembershipId === row.id;
              const canEditRow = canManageMemberships && !row.is_current_user;
              return (
                <tr key={row.id} className={styles.memberTr}>
                  <td className={styles.memberTd}>
                    <span className={styles.memberName}>{row.user_full_name}</span>
                    <span className={styles.memberEmail}>{row.user_email}</span>
                    {row.is_current_user ? (
                      <span className={styles.selfBadge}>You</span>
                    ) : null}
                  </td>
                  <td className={styles.memberTd}>
                    {canEditRow ? (
                      <select
                        className={styles.inlineSelect}
                        value={draft.role}
                        onChange={(e) => updateMembershipDraft(row.id, "role", e.target.value)}
                        disabled={rowIsSaving}
                      >
                        {editableRoles.map((value) => (
                          <option key={value} value={value}>{roleLabel(value)}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={styles.memberRoleText}>{roleLabel(row.role)}</span>
                    )}
                  </td>
                  <td className={styles.memberTd}>
                    {canEditRow ? (
                      <select
                        className={styles.inlineSelect}
                        value={draft.status}
                        onChange={(e) => updateMembershipDraft(row.id, "status", e.target.value)}
                        disabled={rowIsSaving}
                      >
                        {editableStatuses.map((value) => (
                          <option key={value} value={value}>{statusLabel(value)}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={styles.memberRoleText}>{statusLabel(row.status)}</span>
                    )}
                  </td>
                  {canManageMemberships ? (
                    <td className={`${styles.memberTd} ${styles.memberTdAction}`}>
                      {canEditRow ? (
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={() => handleMembershipSave(row)}
                          disabled={!changed || rowIsSaving}
                        >
                          {rowIsSaving ? "Saving\u2026" : "Save"}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ── Invite Section ── */}
      {canInvite ? (
        <div className={styles.inviteSection}>
          <h3 className={styles.sectionSubTitle}>Invite Members</h3>
          <p className={styles.sectionSubCopy}>
            Create invite links to share with new or existing users. Links expire after 24 hours.
          </p>

          <form className={styles.inviteForm} onSubmit={handleCreateInvite}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email</span>
              <input
                type="email"
                value={inviteEmailDraft}
                onChange={(e) => setInviteEmailDraft(e.target.value)}
                placeholder="teammate@example.com"
                required
                disabled={isCreatingInvite}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Role</span>
              <select
                value={inviteRoleDraft}
                onChange={(e) => setInviteRoleDraft(e.target.value)}
                disabled={isCreatingInvite}
              >
                {editableRoles.map((value) => (
                  <option key={value} value={value}>{roleLabel(value)}</option>
                ))}
              </select>
            </label>
            <div className={styles.inviteFormActions}>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={isCreatingInvite || !inviteEmailDraft.trim()}
              >
                {isCreatingInvite ? "Creating\u2026" : "Create Invite"}
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
                      {" \u00b7 "}Invited by {invite.invited_by_email}
                    </p>
                    <p className={styles.memberEmail}>
                      Expires {formatDateTimeDisplay(invite.expires_at)}
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
                      {revokingInviteId === invite.id ? "Revoking\u2026" : "Revoke"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
