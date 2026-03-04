/**
 * Build Authorization and org-scoping headers for API requests.
 *
 * Every authenticated fetch in the app should use `buildAuthHeaders()`
 * to ensure the token and organization context are consistently applied.
 */

import { loadClientSession, type SessionOrganization } from "./client-session";

type BuildAuthHeadersOptions = {
  contentType?: string;
  organization?: SessionOrganization | null;
  headers?: HeadersInit;
};

/**
 * Attach X-Organization-Id header when an organization is present,
 * enabling Django's org-scoped middleware.
 */
function maybeApplyOrganizationHeaders(
  headers: Record<string, string>,
  organization?: SessionOrganization | null,
): void {
  if (!organization) {
    return;
  }

  if (organization.id) {
    headers["X-Organization-Id"] = String(organization.id);
  }
}

/**
 * Construct a complete set of request headers for an authenticated API
 * call. Merges any caller-provided headers, sets Content-Type if
 * specified, applies the auth token, and adds org-scoping headers.
 * Falls back to the session's stored organization if none is provided.
 */
export function buildAuthHeaders(token: string, options?: BuildAuthHeadersOptions): HeadersInit {
  const nextHeaders: Record<string, string> = {};
  if (options?.headers) {
    const base = new Headers(options.headers);
    for (const [key, value] of base.entries()) {
      nextHeaders[key] = value;
    }
  }

  if (options?.contentType && !nextHeaders["Content-Type"]) {
    nextHeaders["Content-Type"] = options.contentType;
  }

  nextHeaders.Authorization = `Token ${token}`;
  const fallbackOrganization = loadClientSession()?.organization ?? null;
  maybeApplyOrganizationHeaders(nextHeaders, options?.organization ?? fallbackOrganization);

  return nextHeaders;
}
