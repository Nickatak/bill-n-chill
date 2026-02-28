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
  sender_name?: string | null;
  sender_email?: string | null;
  sender_address?: string | null;
  help_email?: string | null;
  invoice_default_terms?: string | null;
  estimate_default_terms?: string | null;
  change_order_default_reason?: string | null;
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
  senderEmail: string;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trim a nullable string to a safe empty-string default. */
function normalizeValue(value?: string | null): string {
  return (value || "").trim();
}

/**
 * Split an address string into individual display lines.
 *
 * Handles both newline-delimited and comma-delimited addresses so it works
 * regardless of how the address was entered in organization settings.
 */
export function toAddressLines(value?: string | null): string[] {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return [];
  }
  return normalized
    .replace(/\s*,\s*/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve organization context into a display-ready sender shape.
 *
 * Cascades through available name fields so the document always shows a
 * reasonable company identity even when branding is partially configured.
 */
export function resolvePublicSender(
  organizationContext?: PublicOrganizationContext | null,
): PublicViewerSender {
  const companyName =
    normalizeValue(organizationContext?.display_name) ||
    normalizeValue(organizationContext?.sender_name) ||
    "Your Company";
  const senderName = normalizeValue(organizationContext?.sender_name) || companyName;
  const senderEmail = normalizeValue(organizationContext?.sender_email);
  const senderAddress = normalizeValue(organizationContext?.sender_address);
  const helpEmail = normalizeValue(organizationContext?.help_email) || senderEmail;

  return {
    companyName,
    senderName,
    senderEmail,
    senderAddress,
    senderAddressLines: toAddressLines(senderAddress),
    logoUrl: normalizeValue(organizationContext?.logo_url),
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
 * Look up the default terms/reason text for a given document type.
 *
 * Used to pre-fill the terms section when composing a new document from
 * a public viewer action (e.g. "approve with changes").
 */
export function resolveDefaultTerms(
  organizationContext: PublicOrganizationContext | null | undefined,
  documentType: "estimate" | "invoice" | "change_order",
): string {
  if (!organizationContext) {
    return "";
  }
  if (documentType === "estimate") {
    return normalizeValue(organizationContext.estimate_default_terms);
  }
  if (documentType === "invoice") {
    return normalizeValue(organizationContext.invoice_default_terms);
  }
  return normalizeValue(organizationContext.change_order_default_reason);
}
