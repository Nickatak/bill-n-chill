import type { OrganizationBrandingDefaults } from "./types";

export type ResolvedOrganizationBranding = {
  senderName: string;
  senderDisplayName: string;
  senderEmail: string;
  senderAddress: string;
  senderAddressLines: string[];
  logoUrl: string;
};

export function toAddressLines(address: string): string[] {
  return address
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveOrganizationBranding(
  defaults?: OrganizationBrandingDefaults | null,
): ResolvedOrganizationBranding {
  const senderName = (defaults?.invoice_sender_name || defaults?.display_name || "").trim();
  const senderEmail = (defaults?.invoice_sender_email || "").trim();
  const senderAddress = (defaults?.invoice_sender_address || "").trim();
  const logoUrl = (defaults?.logo_url || "").trim();

  return {
    senderName,
    senderDisplayName: senderName || "Your Company",
    senderEmail,
    senderAddress,
    senderAddressLines: toAddressLines(senderAddress),
    logoUrl,
  };
}
