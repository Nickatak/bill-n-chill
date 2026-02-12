import Link from "next/link";

import { EstimatesConsole } from "@/components/estimates-console";
import styles from "./page.module.css";

export default function EstimatesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Estimates</h1>
          <p>Author estimate versions and clone revisions.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <EstimatesConsole />
        </section>
      </main>
    </div>
  );
}
