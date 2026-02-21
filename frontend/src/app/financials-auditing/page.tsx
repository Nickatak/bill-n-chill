import { FinancialsAuditingConsole } from "@/features/financials-auditing";
import styles from "../vendors/page.module.css";

export default function FinancialsAuditingPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Financials & Auditing</h1>
          <p>
            This non-workflow route centralizes finance controls: summary extraction, immutable
            audit visibility, and accounting sync event operations.
          </p>
          <p>
            It is intentionally operations-focused and acts as the staging area for exports and
            downstream accounting integrations.
          </p>
        </header>
        <section className={styles.card}>
          <FinancialsAuditingConsole />
        </section>
      </main>
    </div>
  );
}
