import { PaymentsConsole } from "@/features/payments";
import styles from "./page.module.css";

export default function PaymentsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Payments</h1>
          <p>
            This route gives users the cash-movement layer for both AR receipts and AP
            disbursements, with explicit status transitions and references.
          </p>
          <p>
            Allocations connect each settled payment to invoices or vendor bills, which is what
            updates balances, payment statuses, and project-level reconciliation metrics.
          </p>
        </header>
        <section className={styles.card}>
          <PaymentsConsole />
        </section>
      </main>
    </div>
  );
}
