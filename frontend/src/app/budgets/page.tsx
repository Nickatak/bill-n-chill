import { BudgetsConsole } from "@/features/budgets";
import styles from "./page.module.css";

export default function BudgetsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Budgets</h1>
          <p>
            This route gives users the internal execution baseline by converting approved estimate
            scope into immutable snapshot + editable working budget lines.
          </p>
          <p>
            It anchors downstream change-order financial propagation and cost tracking, keeping the
            internal money plan aligned with approved client scope decisions.
          </p>
        </header>
        <section className={styles.card}>
          <BudgetsConsole />
        </section>
      </main>
    </div>
  );
}
