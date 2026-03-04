/**
 * Organization branding resolution for the internal document composer.
 *
 * Normalizes the raw organization branding defaults from the API into a
 * display-ready shape used by invoice/estimate/change-order composer headers.
 */

import type { OrganizationBrandingDefaults } from "./types";

/** Resolved branding fields ready for rendering in composer document headers. */
export type ResolvedOrganizationBranding = {
  senderName: string;
  senderDisplayName: string;
  senderAddress: string;
  senderAddressLines: string[];
  logoUrl: string;
  helpEmail: string;
};

/**
 * Split a multi-line address string into individual trimmed lines,
 * discarding any blank entries.
 */
export function toAddressLines(address: string): string[] {
  return address
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Resolve raw organization branding defaults into a normalized shape.
 *
 * Falls back gracefully when individual fields are missing so the composer
 * can always render a reasonable header even for partially-configured orgs.
 */
export function resolveOrganizationBranding(
  defaults?: OrganizationBrandingDefaults | null,
): ResolvedOrganizationBranding {
  const senderName = (defaults?.display_name || "").trim();
  const senderAddress = (defaults?.billing_address || "").trim();
  const logoUrl = (defaults?.logo_url || "").trim();
  const helpEmail = (defaults?.help_email || "").trim();

  return {
    senderName,
    senderDisplayName: senderName || "Your Company",
    senderAddress,
    senderAddressLines: toAddressLines(senderAddress),
    logoUrl,
    helpEmail,
  };
}
