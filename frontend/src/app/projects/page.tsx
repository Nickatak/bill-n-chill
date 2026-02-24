import { ProjectsConsole } from "@/features/projects";
import styles from "./page.module.css";

export default function ProjectsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.card}>
          <ProjectsConsole />
        </section>
      </main>
    </div>
  );
}
