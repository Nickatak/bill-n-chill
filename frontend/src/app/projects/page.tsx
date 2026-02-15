import Link from "next/link";

import { ProjectsConsole } from "@/features/projects";
import styles from "./page.module.css";

export default function ProjectsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Projects</h1>
          <p>Manage project profile and contract baseline fields.</p>
          <Link href="/" className={styles.homeLink}>
            Back to home
          </Link>
        </header>
        <section className={styles.card}>
          <ProjectsConsole />
        </section>
      </main>
    </div>
  );
}
