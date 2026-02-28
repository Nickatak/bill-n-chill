type PublicApiEnvelope<T> = {
  data?: T;
};

type PublicEstimatePayload = {
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

const PUBLIC_REF_TOKEN_PATTERN = /--([A-Za-z0-9]{8,24})$/;
const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

function normalizedApiBaseUrl(): string {
  return defaultApiBaseUrl.trim().replace(/\/$/, "");
}

async function loadPublicPayload<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${normalizedApiBaseUrl()}${path}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as PublicApiEnvelope<T>;
    return payload.data ?? null;
  } catch {
    return null;
  }
}

function trimmedValue(value: string | undefined): string | null {
  const nextValue = value?.trim();
  return nextValue ? nextValue : null;
}

/**
 * Parse the share token from the `slug--token` style public reference.
 * Returns `null` when the route segment does not match expected token shape.
 */
export function parsePublicTokenFromRef(publicRef: string): string | null {
  const match = publicRef.match(PUBLIC_REF_TOKEN_PATTERN);
  return match ? match[1] : null;
}

export function composePublicDocumentMetadataTitle(
  resolvedTitle: string | null,
  fallbackLabel: string,
): string {
  return resolvedTitle ? `${resolvedTitle} | ${fallbackLabel}` : fallbackLabel;
}

export async function resolvePublicEstimateMetadataTitle(
  publicToken: string,
): Promise<string | null> {
  const data = await loadPublicPayload<PublicEstimatePayload>(`/public/estimates/${publicToken}/`);
  if (!data) {
    return null;
  }
  const estimateTitle = trimmedValue(data.title);
  if (estimateTitle) {
    return estimateTitle;
  }
  const projectName = trimmedValue(data.project_context?.name);
  return projectName ? `${projectName} Estimate` : null;
}

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
