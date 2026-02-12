import Link from "next/link";

import { QuickAddConsole } from "@/components/quick-add-console";
import styles from "./page.module.css";

export default function QuickAddPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Intake: Quick Add</h1>
          <p>
            Mobile-first contact capture with duplicate detection and resolution.
          </p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
          <Link href="/projects" className={styles.homeLink}>
            Open projects
          </Link>
        </header>
        <section className={styles.card}>
          <QuickAddConsole />
        </section>
      </main>
    </div>
  );
}
