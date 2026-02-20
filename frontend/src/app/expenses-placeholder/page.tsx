import Link from "next/link";
import styles from "./page.module.css";

export default function ExpensesPlaceholderPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Expenses</h1>
          <p>
            Expenses run as a per-project workflow so ad hoc field spend lands in the correct job
            context.
          </p>
        </header>
        <section className={styles.card}>
          <h2>How to open expenses</h2>
          <p>
            Start from <strong>Projects</strong>, select a project, then choose{" "}
            <strong>Expenses</strong> from that project context.
          </p>
          <Link className={styles.linkButton} href="/projects">
            Go to Projects
          </Link>
        </section>
      </main>
    </div>
  );
}
