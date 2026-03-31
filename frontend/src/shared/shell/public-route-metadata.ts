/**
 * Server-side metadata resolvers for public (tokenized) document routes.
 *
 * Public quote, invoice, and change-order pages use `slug--token`
 * URLs. These helpers fetch minimal payloads from the public API at
 * build/request time so Next.js can populate `<title>` without
 * requiring authentication.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublicApiEnvelope<T> = {
  data?: T;
};

type PublicQuotePayload = {
  title?: string;
  project_context?: { name?: string };
};

type PublicInvoicePayload = {
  invoice_number?: string;
  project_context?: { name?: string };
  id?: number;
};

type PublicChangeOrderPayload = {
  title?: string;
  project_context?: { name?: string };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Matches the `--<token>` suffix in a `slug--token` public reference. */
const PUBLIC_REF_TOKEN_PATTERN = /--([A-Za-z0-9]{8,24})$/;

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Fetch a public API endpoint and unwrap its `{ data }` envelope.
 * Returns `null` on network errors or non-200 responses so callers
 * can fall back to a generic title.
 */
async function loadPublicPayload<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${normalizeApiBaseUrl(defaultApiBaseUrl)}${path}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as PublicApiEnvelope<T>;
    return payload.data ?? null;
  } catch {
    return null;
  }
}

/** Return a trimmed string or `null` if blank/missing. */
function trimmedValue(value: string | undefined): string | null {
  const nextValue = value?.trim();
  return nextValue ? nextValue : null;
}

// ---------------------------------------------------------------------------
// Exported resolvers
// ---------------------------------------------------------------------------

/**
 * Parse the share token from the `slug--token` style public reference.
 * Returns `null` when the route segment does not match expected token shape.
 */
export function parsePublicTokenFromRef(publicRef: string): string | null {
  const match = publicRef.match(PUBLIC_REF_TOKEN_PATTERN);
  return match ? match[1] : null;
}

/**
 * Compose a `<title>` string for a public document page.
 * Prefers the resolved title when available, otherwise uses the fallback.
 */
export function composePublicDocumentMetadataTitle(
  resolvedTitle: string | null,
  fallbackLabel: string,
): string {
  return resolvedTitle ? `${resolvedTitle} | ${fallbackLabel}` : fallbackLabel;
}

/**
 * Resolve a human-readable title for a public quote page.
 * Falls back through: quote title -> project name -> null.
 */
export async function resolvePublicQuoteMetadataTitle(
  publicToken: string,
): Promise<string | null> {
  const data = await loadPublicPayload<PublicQuotePayload>(`/public/quotes/${publicToken}/`);
  if (!data) {
    return null;
  }

  const quoteTitle = trimmedValue(data.title);
  if (quoteTitle) {
    return quoteTitle;
  }

  const projectName = trimmedValue(data.project_context?.name);
  return projectName ? `${projectName} Quote` : null;
}

/**
 * Resolve a human-readable title for a public invoice page.
 * Falls back through: invoice number -> invoice id -> project name -> null.
 */
export async function resolvePublicInvoiceMetadataTitle(publicToken: string): Promise<string | null> {
  const data = await loadPublicPayload<PublicInvoicePayload>(`/public/invoices/${publicToken}/`);
  if (!data) {
    return null;
  }

  const invoiceNumber = trimmedValue(data.invoice_number);
  if (invoiceNumber) {
    return invoiceNumber;
  }

  if (typeof data.id === "number") {
    return `Invoice #${data.id}`;
  }

  const projectName = trimmedValue(data.project_context?.name);
  return projectName ? `${projectName} Invoice` : null;
}

/**
 * Resolve a human-readable title for a public change order page.
 * Falls back through: change order title -> project name -> null.
 */
export async function resolvePublicChangeOrderMetadataTitle(
  publicToken: string,
): Promise<string | null> {
  const data = await loadPublicPayload<PublicChangeOrderPayload>(
    `/public/change-orders/${publicToken}/`,
  );
  if (!data) {
    return null;
  }

  const changeOrderTitle = trimmedValue(data.title);
  if (changeOrderTitle) {
    return changeOrderTitle;
  }

  const projectName = trimmedValue(data.project_context?.name);
  return projectName ? `${projectName} Change Order` : null;
}
