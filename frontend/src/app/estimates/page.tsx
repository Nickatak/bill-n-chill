import { EstimatesConsole } from "@/features/estimates";
import styles from "./page.module.css";

export default function EstimatesPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Estimates</h1>
          <p>
            This route gives users the client-facing pricing lifecycle: author scope lines, revise
            versions, and move statuses through approval decisions.
          </p>
          <p>
            Approved estimates become budget baselines, so accuracy here protects downstream
            planning and billing.
          </p>
        </header>
        <section className={styles.card}>
          <EstimatesConsole />
        </section>
      </main>
    </div>
  );
}
