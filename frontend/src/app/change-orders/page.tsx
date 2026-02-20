import { ChangeOrdersConsole } from "@/features/change-orders";
import styles from "./page.module.css";

export default function ChangeOrdersPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Change Orders</h1>
          <p>
            This route gives users post-baseline scope governance with explicit lifecycle control
            from draft through approval/rejection/void.
          </p>
          <p>
            Approved deltas update the accepted contract total and budget aggregates, which directly
            affects invoice eligibility and overall project financial summary accuracy.
          </p>
        </header>
        <section className={styles.card}>
          <ChangeOrdersConsole />
        </section>
      </main>
    </div>
  );
}
