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
            Approved estimates are the handoff source for budget baselines, making this the bridge
            between early commercial intent and executable financial planning.
          </p>
        </header>
        <section className={styles.card}>
          <EstimatesConsole />
        </section>
      </main>
    </div>
  );
}
