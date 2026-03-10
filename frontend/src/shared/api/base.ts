/**
 * Shared API base URL resolution.
 *
 * Single source of truth for the backend API base URL constant
 * and URL normalization used across all feature API layers.
 */

/** Default API base URL, sourced from environment or falling back to localhost. */
export const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

/**
 * Server-side API base URL for SSR fetches (e.g., health checks in server components).
 * In Docker, the frontend container can't reach the backend via localhost — it needs
 * the Docker service name. Falls back to the public URL for host-mode dev.
 */
export const serverApiBaseUrl =
  process.env.SERVER_API_BASE_URL ?? defaultApiBaseUrl;

/** Strip whitespace and trailing slashes so URL concatenation is safe. */
export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}
