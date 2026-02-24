import { loadClientSession, type SessionOrganization } from "./client-session";

type BuildAuthHeadersOptions = {
  contentType?: string;
  organization?: SessionOrganization | null;
  headers?: HeadersInit;
};

function maybeApplyOrganizationHeaders(
  headers: Record<string, string>,
  organization?: SessionOrganization | null,
): void {
  if (!organization) {
    return;
  }

  if (organization.slug) {
    headers["X-Organization-Slug"] = organization.slug;
  }
  if (organization.id) {
    headers["X-Organization-Id"] = String(organization.id);
  }
}

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
