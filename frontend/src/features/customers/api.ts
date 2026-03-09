/**
 * Customers feature API layer.
 *
 * Re-exports shared base URL helpers and provides API helpers
 * for customer management and quick-add customer intake.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";

export { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

/**
 * Submit a quick-add customer intake record.
 *
 * Creates a new customer with minimal required fields,
 * intended for fast onboarding without a full form flow.
 */
export async function postQuickAddCustomerIntake({
  baseUrl,
  token,
  body,
}: {
  baseUrl: string;
  token: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/customers/quick-add/`, {
    method: "POST",
    headers: buildAuthHeaders(token, { contentType: "application/json" }),
    body: JSON.stringify(body),
  });
  return response;
}
