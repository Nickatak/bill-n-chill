"use client";

/**
 * "Document Settings" tab — help email, due/valid deltas, and T&Cs
 * with Invoice / Estimate / Change Order sub-tabs.
 * Gated by `org_presets.edit` capability (owner + PM).
 */

import { FormEvent, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl, defaultApiBaseUrl } from "../api";
import type {
  ApiResponse,
  OrganizationProfile,
  OrganizationRolePolicy,
} from "../types";
import styles from "./organization-console.module.css";

type DocumentSettingsTabProps = {
  token: string;
  profile: OrganizationProfile;
  canEdit: boolean;
  onProfileUpdate: (profile: OrganizationProfile, rolePolicy?: OrganizationRolePolicy) => void;
  onError: (message: string) => void;
};

type DocType = "invoice" | "estimate" | "change_order";

const DOC_TYPES: Array<{ value: DocType; label: string }> = [
  { value: "invoice", label: "Invoices" },
  { value: "estimate", label: "Estimates" },
  { value: "change_order", label: "Change Orders" },
];

function extractErrorMessage(payload: ApiResponse | null, fallback: string): string {
  if (!payload?.error) return fallback;
  const fieldErrors = Object.values(payload.error.fields ?? {}).flat().filter(Boolean).join(" ");
  return payload.error.message || fieldErrors || fallback;
}

/** Editable form for org-level document defaults (help email, due/valid days, T&Cs per doc type). */
export function DocumentSettingsTab({
  token,
  profile,
  canEdit,
  onProfileUpdate,
  onError,
}: DocumentSettingsTabProps) {
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const [activeDocType, setActiveDocType] = useState<DocType>("invoice");

  const [helpEmailDraft, setHelpEmailDraft] = useState(profile.help_email ?? "");
  const [invoiceDueDeltaDraft, setInvoiceDueDeltaDraft] = useState(
    String(profile.default_invoice_due_delta ?? 30),
  );
  const [estimateValidDeltaDraft, setEstimateValidDeltaDraft] = useState(
    String(profile.default_estimate_valid_delta ?? 30),
  );
  const [invoiceTermsDraft, setInvoiceTermsDraft] = useState(
    profile.invoice_terms_and_conditions ?? "",
  );
  const [estimateTermsDraft, setEstimateTermsDraft] = useState(
    profile.estimate_terms_and_conditions ?? "",
  );
  const [changeOrderTermsDraft, setChangeOrderTermsDraft] = useState(
    profile.change_order_terms_and_conditions ?? "",
  );
  const [isSaving, setIsSaving] = useState(false);

  const hasChanges =
    helpEmailDraft.trim() !== (profile.help_email || "") ||
    String(Number(invoiceDueDeltaDraft || "30")) !==
      String(profile.default_invoice_due_delta || 30) ||
    String(Number(estimateValidDeltaDraft || "30")) !==
      String(profile.default_estimate_valid_delta || 30) ||
    invoiceTermsDraft.trim() !== (profile.invoice_terms_and_conditions || "") ||
    estimateTermsDraft.trim() !== (profile.estimate_terms_and_conditions || "") ||
    changeOrderTermsDraft.trim() !== (profile.change_order_terms_and_conditions || "");

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !hasChanges) return;

    setIsSaving(true);
    onError("");

    const parsedDueDelta = Number(invoiceDueDeltaDraft);
    const sanitizedDueDelta = Number.isFinite(parsedDueDelta)
      ? Math.max(1, Math.min(365, Math.round(parsedDueDelta)))
      : 30;
    const parsedEstimateDelta = Number(estimateValidDeltaDraft);
    const sanitizedEstimateDelta = Number.isFinite(parsedEstimateDelta)
      ? Math.max(1, Math.min(365, Math.round(parsedEstimateDelta)))
      : 30;

    const payload = {
      help_email: helpEmailDraft.trim(),
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
        onError(extractErrorMessage(body, "Could not update document settings."));
        return;
      }

      const data = body.data as
        | { organization?: OrganizationProfile; role_policy?: OrganizationRolePolicy }
        | undefined;
      if (data?.organization) {
        const org = data.organization;
        setHelpEmailDraft(org.help_email ?? "");
        setInvoiceDueDeltaDraft(String(org.default_invoice_due_delta ?? 30));
        setEstimateValidDeltaDraft(String(org.default_estimate_valid_delta ?? 30));
        setInvoiceTermsDraft(org.invoice_terms_and_conditions ?? "");
        setEstimateTermsDraft(org.estimate_terms_and_conditions ?? "");
        setChangeOrderTermsDraft(org.change_order_terms_and_conditions ?? "");
        onProfileUpdate(org, data.role_policy ?? undefined);
      }
    } catch {
      onError("Could not reach organization profile update endpoint.");
    } finally {
      setIsSaving(false);
    }
  }

  const disabled = !canEdit || isSaving;

  return (
    <form className={styles.profileForm} onSubmit={handleSave}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Help Email</span>
        <input
          value={helpEmailDraft}
          onChange={(e) => setHelpEmailDraft(e.target.value)}
          type="email"
          placeholder="help@example.com"
          disabled={disabled}
        />
      </label>

      <div className={styles.docTypeTabs}>
        {DOC_TYPES.map((dt) => (
          <button
            key={dt.value}
            type="button"
            className={`${styles.docTypeTab} ${activeDocType === dt.value ? styles.docTypeTabActive : ""}`}
            onClick={() => setActiveDocType(dt.value)}
          >
            {dt.label}
          </button>
        ))}
      </div>

      {activeDocType === "invoice" ? (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Default Due Days</span>
            <input
              value={invoiceDueDeltaDraft}
              onChange={(e) => setInvoiceDueDeltaDraft(e.target.value)}
              type="number"
              min={1}
              max={365}
              disabled={disabled}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Invoice Terms &amp; Conditions</span>
            <textarea
              value={invoiceTermsDraft}
              onChange={(e) => setInvoiceTermsDraft(e.target.value)}
              rows={4}
              placeholder="Payment terms, late fees, payment instructions..."
              disabled={disabled}
            />
          </label>
        </>
      ) : null}

      {activeDocType === "estimate" ? (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Estimate Valid Days</span>
            <input
              value={estimateValidDeltaDraft}
              onChange={(e) => setEstimateValidDeltaDraft(e.target.value)}
              type="number"
              min={1}
              max={365}
              disabled={disabled}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Estimate Terms &amp; Conditions</span>
            <textarea
              value={estimateTermsDraft}
              onChange={(e) => setEstimateTermsDraft(e.target.value)}
              rows={4}
              placeholder="Default terms and conditions shown on estimates"
              disabled={disabled}
            />
          </label>
        </>
      ) : null}

      {activeDocType === "change_order" ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Change Order Terms &amp; Conditions</span>
          <textarea
            value={changeOrderTermsDraft}
            onChange={(e) => setChangeOrderTermsDraft(e.target.value)}
            rows={4}
            placeholder="Default terms and conditions for change orders"
            disabled={disabled}
          />
        </label>
      ) : null}

      <div className={styles.profileActions}>
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={disabled || !hasChanges}
        >
          {isSaving ? "Saving\u2026" : "Save"}
        </button>
        {!canEdit ? (
          <span className={styles.permissionHint}>
            Your role is read-only for document settings.
          </span>
        ) : null}
      </div>
    </form>
  );
}
