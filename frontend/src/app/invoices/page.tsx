import { InvoicesConsole } from "@/features/invoices";
import styles from "./page.module.css";

export default function InvoicesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <InvoicesConsole />
        </section>
      </main>
    </div>
  );
}
