import Link from "next/link";

import { PaymentsConsole } from "@/features/payments";
import styles from "./page.module.css";

export default function PaymentsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Payments</h1>
          <p>Record inbound/outbound payments and track payment lifecycle statuses.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <PaymentsConsole />
        </section>
      </main>
    </div>
  );
}
