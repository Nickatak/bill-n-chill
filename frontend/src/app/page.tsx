import Link from "next/link";

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
          Django/DRF backend and Next.js frontend scaffold is running.
        </p>
        <div className={styles.healthCard} data-ok={health.ok ? "true" : "false"}>
          <p className={styles.label}>GET /api/v1/health/</p>
          <p className={styles.status}>{health.ok ? "OK" : "ERROR"}</p>
          <p className={styles.message}>{health.message}</p>
        </div>
        <div className={styles.nextCard}>
          <p className={styles.nextTitle}>Workflow Routes (In Order)</p>
          <p className={styles.nextText}>
            Use these routes in sequence for the current MVP flow.
          </p>
          <ol className={styles.routeList}>
            <li>
              <Link href="/intake/quick-add" className={styles.nextLink}>
                /intake/quick-add
              </Link>
              <span className={styles.routeHint}>
                Capture lead, resolve duplicates, convert to project shell.
              </span>
            </li>
            <li>
              <Link href="/projects" className={styles.nextLink}>
                /projects
              </Link>
              <span className={styles.routeHint}>
                Edit project profile, contract baseline, and planned dates.
              </span>
            </li>
            <li>
              <Link href="/cost-codes" className={styles.nextLink}>
                /cost-codes
              </Link>
              <span className={styles.routeHint}>
                Create and maintain reusable cost codes for estimating.
              </span>
            </li>
            <li>
              <Link href="/estimates" className={styles.nextLink}>
                /estimates
              </Link>
              <span className={styles.routeHint}>
                Author estimate versions and clone revisions.
              </span>
            </li>
            <li>
              <Link href="/budgets" className={styles.nextLink}>
                /budgets
              </Link>
              <span className={styles.routeHint}>
                Convert approved estimates into budget baseline + editable working lines.
              </span>
            </li>
            <li>
              <Link href="/change-orders" className={styles.nextLink}>
                /change-orders
              </Link>
              <span className={styles.routeHint}>
                Create and route change orders through lifecycle states.
              </span>
            </li>
            <li>
              <Link href="/invoices" className={styles.nextLink}>
                /invoices
              </Link>
              <span className={styles.routeHint}>
                Compose owner invoices, send them, and track invoice status lifecycle.
              </span>
            </li>
            <li>
              <Link href="/vendors" className={styles.nextLink}>
                /vendors
              </Link>
              <span className={styles.routeHint}>
                Manage vendor directory records for upcoming AP and commitment flows.
              </span>
            </li>
            <li>
              <Link href="/vendor-bills" className={styles.nextLink}>
                /vendor-bills
              </Link>
              <span className={styles.routeHint}>
                Capture vendor AP bills and move them through payable lifecycle statuses.
              </span>
            </li>
            <li>
              <Link href="/payments" className={styles.nextLink}>
                /payments
              </Link>
              <span className={styles.routeHint}>
                Record inbound and outbound payments with method/status/reference tracking.
              </span>
            </li>
          </ol>
        </div>
      </main>
    </div>
  );
}
