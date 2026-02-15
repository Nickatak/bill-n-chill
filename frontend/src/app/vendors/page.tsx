import Link from "next/link";

import { VendorsConsole } from "@/features/vendors";
import styles from "./page.module.css";

export default function VendorsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Vendors</h1>
          <p>Maintain a reusable vendor directory for AP bills and commitments.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <VendorsConsole />
        </section>
      </main>
    </div>
  );
}
