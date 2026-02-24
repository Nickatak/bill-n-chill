import { ChangeOrdersConsole } from "@/features/change-orders";
import styles from "./page.module.css";

export default function ChangeOrdersPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Change Orders (WIP)</h1>
          <p>Manage post-estimate scope and cost revisions.</p>
        </header>
        <section className={styles.card}>
          <ChangeOrdersConsole />
        </section>
      </main>
    </div>
  );
}
