"use client";

/**
 * "My Business" tab — identity fields for the organization profile.
 * Covers: display name, logo, phone, website, license #, tax ID, billing address.
 * All fields gated by `org_identity.edit` capability (owner-only).
 */

import { FormEvent, useState } from "react";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { normalizeApiBaseUrl, defaultApiBaseUrl } from "../api";
import type {
  ApiResponse,
  OrganizationProfile,
  OrganizationRolePolicy,
} from "../types";
import styles from "./organization-console.module.css";

type BusinessProfileTabProps = {
  token: string;
  profile: OrganizationProfile;
  canEdit: boolean;
  onProfileUpdate: (profile: OrganizationProfile, rolePolicy?: OrganizationRolePolicy) => void;
  onError: (message: string) => void;
};

function extractErrorMessage(payload: ApiResponse | null, fallback: string): string {
  if (!payload?.error) return fallback;
  const fieldErrors = Object.values(payload.error.fields ?? {}).flat().filter(Boolean).join(" ");
  return payload.error.message || fieldErrors || fallback;
}

export function BusinessProfileTab({
  token,
  profile,
  canEdit,
  onProfileUpdate,
  onError,
}: BusinessProfileTabProps) {
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const [displayNameDraft, setDisplayNameDraft] = useState(profile.display_name);
  const [logoUrlDraft, setLogoUrlDraft] = useState(profile.logo_url ?? "");
  const [phoneNumberDraft, setPhoneNumberDraft] = useState(profile.phone_number ?? "");
  const [websiteUrlDraft, setWebsiteUrlDraft] = useState(profile.website_url ?? "");
  const [licenseNumberDraft, setLicenseNumberDraft] = useState(profile.license_number ?? "");
  const [taxIdDraft, setTaxIdDraft] = useState(profile.tax_id ?? "");
  const [billingAddressDraft, setBillingAddressDraft] = useState(profile.billing_address ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const hasChanges =
    displayNameDraft.trim() !== profile.display_name ||
    logoUrlDraft.trim() !== (profile.logo_url || "") ||
    phoneNumberDraft.trim() !== (profile.phone_number || "") ||
    websiteUrlDraft.trim() !== (profile.website_url || "") ||
    licenseNumberDraft.trim() !== (profile.license_number || "") ||
    taxIdDraft.trim() !== (profile.tax_id || "") ||
    billingAddressDraft.trim() !== (profile.billing_address || "");

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !hasChanges) return;

    setIsSaving(true);
    onError("");

    const payload = {
      display_name: displayNameDraft.trim(),
      logo_url: logoUrlDraft.trim(),
      phone_number: phoneNumberDraft.trim(),
      website_url: websiteUrlDraft.trim(),
      license_number: licenseNumberDraft.trim(),
      tax_id: taxIdDraft.trim(),
      billing_address: billingAddressDraft.trim(),
    };

    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify(payload),
      });
      const body: ApiResponse = await response.json();
      if (!response.ok) {
        onError(extractErrorMessage(body, "Could not update business profile."));
        return;
      }

      const data = body.data as
        | { organization?: OrganizationProfile; role_policy?: OrganizationRolePolicy }
        | undefined;
      if (data?.organization) {
        const org = data.organization;
        setDisplayNameDraft(org.display_name);
        setLogoUrlDraft(org.logo_url ?? "");
        setPhoneNumberDraft(org.phone_number ?? "");
        setWebsiteUrlDraft(org.website_url ?? "");
        setLicenseNumberDraft(org.license_number ?? "");
        setTaxIdDraft(org.tax_id ?? "");
        setBillingAddressDraft(org.billing_address ?? "");
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
        <span className={styles.fieldLabel}>Company Name</span>
        <input
          value={displayNameDraft}
          onChange={(e) => setDisplayNameDraft(e.target.value)}
          disabled={disabled}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Logo URL</span>
        <input
          value={logoUrlDraft}
          onChange={(e) => setLogoUrlDraft(e.target.value)}
          placeholder="https://example.com/logo.png"
          disabled={disabled}
        />
      </label>

      <hr className={styles.fieldGroupDivider} />

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Phone</span>
          <input
            value={phoneNumberDraft}
            onChange={(e) => setPhoneNumberDraft(e.target.value)}
            placeholder="(555) 123-4567"
            disabled={disabled}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Website</span>
          <input
            value={websiteUrlDraft}
            onChange={(e) => setWebsiteUrlDraft(e.target.value)}
            placeholder="https://yourcompany.com"
            disabled={disabled}
          />
        </label>
      </div>

      <hr className={styles.fieldGroupDivider} />

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Contractor License #</span>
          <input
            value={licenseNumberDraft}
            onChange={(e) => setLicenseNumberDraft(e.target.value)}
            placeholder="e.g. CSLB #1234567"
            disabled={disabled}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Tax ID / EIN</span>
          <input
            value={taxIdDraft}
            onChange={(e) => setTaxIdDraft(e.target.value)}
            placeholder="e.g. 12-3456789"
            disabled={disabled}
          />
        </label>
      </div>

      <hr className={styles.fieldGroupDivider} />

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Billing Address</span>
        <textarea
          value={billingAddressDraft}
          onChange={(e) => setBillingAddressDraft(e.target.value)}
          rows={3}
          placeholder="Street, city, state, ZIP"
          disabled={disabled}
        />
      </label>

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
            Your role is read-only for business profile settings.
          </span>
        ) : null}
      </div>
    </form>
  );
}
