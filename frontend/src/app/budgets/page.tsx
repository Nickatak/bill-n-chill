import Link from "next/link";

import { BudgetsConsole } from "@/features/budgets";
import styles from "./page.module.css";

export default function BudgetsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Budgets</h1>
          <p>Convert approved estimates into an immutable baseline and editable working budget.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <BudgetsConsole />
        </section>
      </main>
    </div>
  );
}
