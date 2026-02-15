import Link from "next/link";

import { ChangeOrdersConsole } from "@/features/change-orders";
import styles from "./page.module.css";

export default function ChangeOrdersPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Change Orders</h1>
          <p>Create and route scope changes through draft, approval, rejection, and void states.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <ChangeOrdersConsole />
        </section>
      </main>
    </div>
  );
}
