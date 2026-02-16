import { InvoicesConsole } from "@/features/invoices";
import styles from "./page.module.css";

export default function InvoicesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Invoices</h1>
          <p>
            This route gives users the AR billing workflow: compose customer invoice lines, enforce
            scope controls, and move invoices through delivery and payment states.
          </p>
          <p>
            It connects approved scope to collected cash, and payment allocations later use these
            invoices as targets to drive paid balances and project-level AR visibility.
          </p>
        </header>
        <section className={styles.card}>
          <InvoicesConsole />
        </section>
      </main>
    </div>
  );
}
