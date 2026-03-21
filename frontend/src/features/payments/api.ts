/**
 * Payments feature API layer.
 *
 * Re-exports shared base URL helpers and provides the payment
 * policy contract fetcher that drives workflow rules in the UI.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";

export { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Fetch the payment policy contract from the backend.
 *
 * The contract defines allowed statuses, transitions, and field
 * constraints the frontend uses to render payment workflows.
 */
export async function fetchPaymentPolicyContract({
  baseUrl,
  authToken,
}: {
  baseUrl: string;
  authToken: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/contracts/payments/`, {
    headers: buildAuthHeaders(authToken),
  });
  return response;
}
