import type { Metadata } from "next";
import { ChangeOrdersConsole } from "@/features/change-orders";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Change Orders",
};

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
