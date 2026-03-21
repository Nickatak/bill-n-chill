/**
 * Vendor-bills feature API layer.
 *
 * Re-exports shared base URL helpers and provides the vendor-bill
 * policy contract fetcher that drives workflow rules in the UI.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";

export { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Fetch the vendor-bill policy contract from the backend.
 *
 * The contract defines allowed statuses, transitions, and field
 * constraints the frontend uses to render vendor-bill workflows.
 */
export async function fetchVendorBillPolicyContract({
  baseUrl,
  authToken,
}: {
  baseUrl: string;
  authToken: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/contracts/vendor-bills/`, {
    headers: buildAuthHeaders(authToken),
  });
  return response;
}
