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

type PublicProjectContext = {
  customer_display_name?: string | null;
  customer_billing_address?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
};

export type PublicViewerSender = {
  companyName: string;
  senderName: string;
  senderEmail: string;
  senderAddress: string;
  senderAddressLines: string[];
  logoUrl: string;
  helpEmail: string;
};

export type PublicViewerRecipient = {
  name: string;
  address: string;
  addressLines: string[];
  email: string;
  phone: string;
};

function normalizeValue(value?: string | null): string {
  return (value || "").trim();
}

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
