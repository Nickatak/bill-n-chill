/**
 * Quotes feature API layer.
 *
 * Re-exports shared base URL helpers and provides the quote
 * policy contract fetcher that drives workflow rules in the UI.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";

export { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Fetch the quote policy contract from the backend.
 *
 * The contract defines allowed statuses, transitions, and field
 * constraints the frontend uses to render quote workflows.
 */
export async function fetchQuotePolicyContract({
  baseUrl,
  authToken,
}: {
  baseUrl: string;
  authToken: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/contracts/quotes/`, {
    headers: buildAuthHeaders(authToken),
  });
  return response;
}
