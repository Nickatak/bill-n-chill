/**
 * Server-side health check against the Django backend.
 *
 * Calls `GET /api/v1/health/` (no-cache) and normalises the response into a
 * simple ok/message shape that route pages pass to their client components.
 * Used by both the home (`/`) and register (`/register`) routes to display
 * backend connectivity and build metadata.
 */

/** Raw JSON shape returned by the Django health endpoint. */
type HealthResponse = {
  data?: {
    status?: string;
    app_revision?: string | null;
    app_build_at?: string | null;
    data_reset_at?: string | null;
  };
};

/** Normalised result passed to client components. */
export type HealthResult = {
  ok: boolean;
  message: string;
  appRevision?: string;
  appBuildAt?: string;
  dataResetAt?: string;
};

export async function fetchHealth(): Promise<HealthResult> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
  const url = `${baseUrl.replace(/\/$/, "")}/health/`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload: HealthResponse = await response.json();
    const status = payload?.data?.status;
    const appRevision = payload?.data?.app_revision ?? undefined;
    const appBuildAt = payload?.data?.app_build_at ?? undefined;
    const dataResetAt = payload?.data?.data_reset_at ?? undefined;

    if (response.ok && status === "ok") {
      return { ok: true, message: "Backend is healthy.", appRevision, appBuildAt, dataResetAt };
    }

    return {
      ok: false,
      message: "Backend responded, but health status is not ok.",
      appRevision,
      appBuildAt,
      dataResetAt,
    };
  } catch {
    return { ok: false, message: "Could not reach backend health endpoint." };
  }
}
