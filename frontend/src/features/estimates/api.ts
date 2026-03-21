/**
 * Estimates feature API layer.
 *
 * Re-exports shared base URL helpers and provides the estimate
 * policy contract fetcher that drives workflow rules in the UI.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";

export { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Fetch the estimate policy contract from the backend.
 *
 * The contract defines allowed statuses, transitions, and field
 * constraints the frontend uses to render estimate workflows.
 */
export async function fetchEstimatePolicyContract({
  baseUrl,
  authToken,
}: {
  baseUrl: string;
  authToken: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/contracts/estimates/`, {
    headers: buildAuthHeaders(authToken),
  });
  return response;
}
