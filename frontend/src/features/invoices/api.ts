/**
 * Invoices feature API layer.
 *
 * Re-exports shared base URL helpers and provides the invoice
 * policy contract fetcher that drives workflow rules in the UI.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";

export { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Fetch the invoice policy contract from the backend.
 *
 * The contract defines allowed statuses, transitions, and field
 * constraints the frontend uses to render invoice workflows.
 */
export async function fetchInvoicePolicyContract({
  baseUrl,
  authToken,
}: {
  baseUrl: string;
  authToken: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/contracts/invoices/`, {
    headers: buildAuthHeaders(authToken),
  });
  return response;
}
