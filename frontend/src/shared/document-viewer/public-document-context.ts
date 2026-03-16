/**
 * Context resolution for public (token-authenticated) document viewers.
 *
 * Public viewer pages receive minimal organization and project context from
 * the API. These helpers normalize that raw context into display-ready sender
 * and recipient shapes so individual viewer pages don't duplicate fallback logic.
 */

// ---------------------------------------------------------------------------
// Raw API context shapes
// ---------------------------------------------------------------------------

/** Organization-level fields available on public document endpoints. */
type PublicOrganizationContext = {
  display_name?: string | null;
  logo_url?: string | null;
  billing_address?: string | null;
  help_email?: string | null;
  invoice_terms_and_conditions?: string | null;
  estimate_terms_and_conditions?: string | null;
  change_order_terms_and_conditions?: string | null;
};

/** Project-level customer fields available on public document endpoints. */
type PublicProjectContext = {
  customer_display_name?: string | null;
  customer_billing_address?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
};

// ---------------------------------------------------------------------------
// Resolved display shapes
// ---------------------------------------------------------------------------

/** Normalized sender information ready for rendering in document headers. */
export type PublicViewerSender = {
  companyName: string;
  senderName: string;
  senderAddress: string;
  senderAddressLines: string[];
  logoUrl: string;
  helpEmail: string;
};

/** Normalized recipient information ready for rendering in document headers. */
export type PublicViewerRecipient = {
  name: string;
  address: string;
  addressLines: string[];
  email: string;
  phone: string;
};

import { toAddressLines } from "../utils/address";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trim a nullable string to a safe empty-string default. */
function normalizeValue(value?: string | null): string {
  return (value || "").trim();
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/** Document-level sender identity frozen at send time. */
type DocumentSenderOverrides = {
  sender_name?: string | null;
  sender_address?: string | null;
  sender_logo_url?: string | null;
};

/**
 * Resolve organization context into a display-ready sender shape.
 *
 * When a document carries its own frozen sender fields (stamped at send time),
 * those take precedence over the live organization context. This prevents
 * retroactive identity changes from altering previously-sent documents.
 */
export function resolvePublicSender(
  organizationContext?: PublicOrganizationContext | null,
  documentSender?: DocumentSenderOverrides | null,
): PublicViewerSender {
  const companyName =
    normalizeValue(documentSender?.sender_name)
    || normalizeValue(organizationContext?.display_name)
    || "Your Company";
  const senderName = companyName;
  const senderAddress =
    normalizeValue(documentSender?.sender_address)
    || normalizeValue(organizationContext?.billing_address);
  const helpEmail = normalizeValue(organizationContext?.help_email);
  const logoUrl =
    normalizeValue(documentSender?.sender_logo_url)
    || normalizeValue(organizationContext?.logo_url);

  return {
    companyName,
    senderName,
    senderAddress,
    senderAddressLines: toAddressLines(senderAddress),
    logoUrl,
    helpEmail,
  };
}

/**
 * Resolve project context into a display-ready recipient shape.
 *
 * Falls back to "Customer" when no display name is available so the
 * document header always has a label for the recipient block.
 */
export function resolvePublicRecipient(
  projectContext?: PublicProjectContext | null,
): PublicViewerRecipient {
  const name = normalizeValue(projectContext?.customer_display_name) || "Customer";
  const address = normalizeValue(projectContext?.customer_billing_address);

  return {
    name,
    address,
    addressLines: toAddressLines(address),
    email: normalizeValue(projectContext?.customer_email),
    phone: normalizeValue(projectContext?.customer_phone),
  };
}

/**
 * Look up the default terms text for a given document type.
 */
export function resolveDefaultTerms(
  organizationContext: PublicOrganizationContext | null | undefined,
  documentType: "estimate" | "invoice" | "change_order",
): string {
  if (!organizationContext) {
    return "";
  }
  if (documentType === "estimate") {
    return normalizeValue(organizationContext.estimate_terms_and_conditions);
  }
  if (documentType === "invoice") {
    return normalizeValue(organizationContext.invoice_terms_and_conditions);
  }
  return normalizeValue(organizationContext.change_order_terms_and_conditions);
}
