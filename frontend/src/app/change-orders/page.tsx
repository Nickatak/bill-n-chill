import { ChangeOrdersConsole } from "@/features/change-orders";
import styles from "./page.module.css";

export default function ChangeOrdersPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <ChangeOrdersConsole />
        </section>
      </main>
    </div>
  );
}
