import { CostCodesConsole } from "@/features/cost-codes";
import styles from "./page.module.css";

export default function CostCodesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Cost Codes</h1>
          <p>
            Maintain the shared catalog used to classify line items across estimates, budgets, and
            invoices.
          </p>
          <p>Keep this list tight so downstream reporting and approvals stay consistent.</p>
        </header>
        <section className={styles.card}>
          <CostCodesConsole />
        </section>
      </main>
    </div>
  );
}
