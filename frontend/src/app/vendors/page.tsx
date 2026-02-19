import Link from "next/link";
import styles from "./page.module.css";

export default function VendorsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Vendors</h1>
          <p>
            Vendors now run within the Vendor Bills workflow so payee setup and expense capture
            stay in one place.
          </p>
        </header>
        <section className={styles.card}>
          <h2>Where to manage vendors</h2>
          <p>
            Open <strong>Vendor Bills</strong> to manage vendors and record vendor bills together.
          </p>
          <Link className={styles.linkButton} href="/vendor-bills">
            Go to Vendor Bills
          </Link>
        </section>
      </main>
    </div>
  );
}
