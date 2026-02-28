/**
 * Change-order feature API layer.
 *
 * Handles base URL resolution and fetching the change-order
 * policy contract that drives workflow rules in the UI.
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
