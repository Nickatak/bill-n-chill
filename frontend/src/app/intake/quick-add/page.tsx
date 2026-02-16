import { QuickAddConsole } from "@/features/intake";
import styles from "./page.module.css";

export default function QuickAddPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Intake: Quick Add</h1>
          <p>
            This route gives field and office users a fast way to capture a qualified lead with
            duplicate detection and explicit resolution before bad data spreads.
          </p>
          <p>
            It is the workflow entry point: successful conversion here creates the Customer +
            Project shell used by every downstream route in the financial loop.
          </p>
        </header>
        <section className={styles.card}>
          <QuickAddConsole />
        </section>
      </main>
    </div>
  );
}
