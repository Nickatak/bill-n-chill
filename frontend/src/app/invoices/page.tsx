import Link from "next/link";

import { InvoicesConsole } from "@/features/invoices";
import styles from "./page.module.css";

export default function InvoicesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Invoices</h1>
          <p>Compose owner invoices, calculate totals, and move through send/payment lifecycle states.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <InvoicesConsole />
        </section>
      </main>
    </div>
  );
}
