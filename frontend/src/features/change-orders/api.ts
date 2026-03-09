/**
 * Change-order feature API layer.
 *
 * Re-exports shared base URL helpers and provides the change-order
 * policy contract fetcher that drives workflow rules in the UI.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";

export { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Fetch the change-order policy contract from the backend.
 *
 * The contract defines allowed statuses, transitions, and field
 * constraints the frontend uses to render change-order workflows.
 */
export async function fetchChangeOrderPolicyContract({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/contracts/change-orders/`, {
    headers: buildAuthHeaders(token),
  });
  return response;
}
