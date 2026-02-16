import { CostCodesConsole } from "@/features/cost-codes";
import styles from "./page.module.css";

export default function CostCodesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Cost Codes</h1>
          <p>
            This route gives users a reusable cost classification catalog so line-level financial
            records stay normalized and comparable.
          </p>
          <p>
            Those codes are shared across estimates, budgets, and invoice lines, so consistency
            here directly improves downstream reporting, reconciliation, and audit traceability.
          </p>
        </header>
        <section className={styles.card}>
          <CostCodesConsole />
        </section>
      </main>
    </div>
  );
}
