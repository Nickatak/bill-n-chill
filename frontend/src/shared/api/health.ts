/**
 * Server-side health check against the Django backend.
 *
 * Calls `GET /api/v1/health/` (no-cache) and normalises the response into a
 * simple ok/message shape that route pages pass to their client components.
 */

import { serverApiBaseUrl, normalizeApiBaseUrl } from "./base";

/** Normalised result passed to client components. */
export type HealthResult = {
  ok: boolean;
  message: string;
};

export async function fetchHealth(): Promise<HealthResult> {
  const url = `${normalizeApiBaseUrl(serverApiBaseUrl)}/health/`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
    const status = payload?.data?.status;

    if (response.ok && status === "ok") {
      return { ok: true, message: "Backend is healthy." };
    }

    return { ok: false, message: "Backend responded, but health status is not ok." };
  } catch {
    return { ok: false, message: "Could not reach backend health endpoint." };
  }
}
