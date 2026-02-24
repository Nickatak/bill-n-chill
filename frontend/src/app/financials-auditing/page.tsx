import { FinancialsAuditingConsole } from "@/features/financials-auditing";
import { PaymentsConsole } from "@/features/payments";
import styles from "../vendors/page.module.css";

export default function FinancialsAuditingPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Financials & Accounting (WIP)</h1>
          <p>
            This route centralizes finance controls: summary extraction, immutable
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
        <section className={styles.card}>
          <h2>Payments</h2>
          <p>
            AR receipts and AP disbursements live here as part of the accounting surface for
            allocation, reconciliation, and downstream sync.
          </p>
          <PaymentsConsole />
        </section>
      </main>
    </div>
  );
}
