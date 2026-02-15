import Link from "next/link";

import { CostCodesConsole } from "@/features/cost-codes";
import styles from "./page.module.css";

export default function CostCodesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Cost Codes</h1>
          <p>Manage reusable cost codes for estimating and budgeting.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <CostCodesConsole />
        </section>
      </main>
    </div>
  );
}
