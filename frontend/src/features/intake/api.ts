/**
 * Intake feature API layer.
 *
 * Handles base URL resolution and the quick-add customer
 * intake endpoint used during onboarding flows.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";

/** Default API base URL, sourced from environment or falling back to localhost. */
export const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

/** Strip whitespace and trailing slashes so URL concatenation is safe. */
export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

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
