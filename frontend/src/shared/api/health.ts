/**
 * Server-side health check against the Django backend.
 *
 * Calls `GET /api/v1/health/` (no-cache) and normalises the response into a
 * simple ok/message shape that route pages pass to their client components.
 */

/** Normalised result passed to client components. */
export type HealthResult = {
  ok: boolean;
  message: string;
};

export async function fetchHealth(): Promise<HealthResult> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
  const url = `${baseUrl.replace(/\/$/, "")}/health/`;

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
