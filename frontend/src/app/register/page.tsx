import { HomeRegisterConsole } from "@/features/session/components/home-register-console";
import homeStyles from "../page.module.css";

type HealthResponse = {
  data?: {
    status?: string;
    app_revision?: string | null;
    app_build_at?: string | null;
    data_reset_at?: string | null;
  };
};

async function fetchHealth(): Promise<{
  ok: boolean;
  message: string;
  appRevision?: string;
  appBuildAt?: string;
  dataResetAt?: string;
}> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
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

export default async function RegisterPage() {
  const health = await fetchHealth();

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <h1 className={homeStyles.title}>bill-n-chill</h1>
        <p className={homeStyles.subtitle}>Create a temporary account for this preview environment.</p>
        <HomeRegisterConsole health={health} />
      </main>
    </div>
  );
}
