import { HomeRouteContent } from "./home-route-content";

type HealthResponse = {
  data?: {
    status?: string;
    app_revision?: string | null;
    data_reset_at?: string | null;
  };
};

async function fetchHealth(): Promise<{
  ok: boolean;
  message: string;
  appRevision?: string;
  dataResetAt?: string;
}> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
  const url = `${baseUrl.replace(/\/$/, "")}/health/`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload: HealthResponse = await response.json();
    const status = payload?.data?.status;
    const appRevision = payload?.data?.app_revision ?? undefined;
    const dataResetAt = payload?.data?.data_reset_at ?? undefined;

    if (response.ok && status === "ok") {
      return { ok: true, message: "Backend is healthy.", appRevision, dataResetAt };
    }

    return {
      ok: false,
      message: "Backend responded, but health status is not ok.",
      appRevision,
      dataResetAt,
    };
  } catch {
    return { ok: false, message: "Could not reach backend health endpoint." };
  }
}

export default async function Home() {
  const health = await fetchHealth();

  return (
    <HomeRouteContent health={health} />
  );
}
