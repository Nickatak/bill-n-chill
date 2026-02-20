import Link from "next/link";
import styles from "./page.module.css";

export default function VendorBillsPlaceholderPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Vendor Bills</h1>
          <p>
            Vendor bills now run as a per-project workflow. This keeps AP intake, allocations, and
            status transitions scoped to a single job.
          </p>
        </header>
        <section className={styles.card}>
          <h2>How to open vendor bills</h2>
          <p>
            Start from <strong>Projects</strong>, select a project, then choose{" "}
            <strong>Vendor Bills</strong> from that project context.
          </p>
          <Link className={styles.linkButton} href="/projects">
            Go to Projects
          </Link>
        </section>
      </main>
    </div>
  );
}
