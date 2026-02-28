/**
 * Cost-codes feature API configuration.
 *
 * Provides base URL resolution for cost-code CRUD and
 * lookup API calls used across estimating and budgets.
 */

/** Default API base URL, sourced from environment or falling back to localhost. */
export const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

/** Strip whitespace and trailing slashes so URL concatenation is safe. */
export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}
