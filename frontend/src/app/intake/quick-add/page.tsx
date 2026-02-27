import type { Metadata } from "next";
import { QuickAddConsole } from "@/features/intake";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Quick Add Customer",
};

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
