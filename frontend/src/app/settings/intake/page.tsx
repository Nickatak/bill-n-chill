"use client";

import { IntakeSettingsConsole } from "@/features/settings-intake";
import styles from "./page.module.css";

export default function IntakeSettingsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <IntakeSettingsConsole />
        </section>
      </main>
    </div>
  );
}
