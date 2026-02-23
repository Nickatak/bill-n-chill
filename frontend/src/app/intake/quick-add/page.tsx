import { QuickAddConsole } from "@/features/intake";
import styles from "./page.module.css";

export default function QuickAddPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <QuickAddConsole />
        </section>
      </main>
    </div>
  );
}
