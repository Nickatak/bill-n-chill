import Link from "next/link";

import { VendorBillsConsole } from "@/features/vendor-bills";
import styles from "./page.module.css";

export default function VendorBillsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Vendor Bills</h1>
          <p>Intake vendor AP bills and manage payable lifecycle statuses.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <VendorBillsConsole />
        </section>
      </main>
    </div>
  );
}
