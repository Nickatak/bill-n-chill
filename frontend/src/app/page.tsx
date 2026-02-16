import { HomeAuthConsole } from "@/features/session/components/home-auth-console";
import styles from "./page.module.css";

type HealthResponse = {
  data?: {
    status?: string;
  };
};

async function fetchHealth(): Promise<{ ok: boolean; message: string }> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
  const url = `${baseUrl.replace(/\/$/, "")}/health/`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const payload: HealthResponse = await response.json();
    const status = payload?.data?.status;

    if (response.ok && status === "ok") {
      return { ok: true, message: "Backend is healthy." };
    }

    return { ok: false, message: "Backend responded, but health status is not ok." };
  } catch {
    return { ok: false, message: "Could not reach backend health endpoint." };
  }
}

export default async function Home() {
  const health = await fetchHealth();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>bill-n-chill</h1>
        <p className={styles.subtitle}>
          Django/DRF backend and Next.js frontend scaffold is running. Use the ordered
          workflow navbar at the top on every page during development.
        </p>
        <div className={styles.healthCard} data-ok={health.ok ? "true" : "false"}>
          <p className={styles.label}>GET /api/v1/health/</p>
          <p className={styles.status}>{health.ok ? "OK" : "ERROR"}</p>
          <p className={styles.message}>{health.message}</p>
        </div>
        <div className={styles.nextCard}>
          <HomeAuthConsole />
        </div>
      </main>
    </div>
  );
}
