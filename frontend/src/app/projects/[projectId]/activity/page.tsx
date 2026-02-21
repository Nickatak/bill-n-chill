import { ProjectActivityConsole } from "@/features/projects/components/project-activity-console";
import { redirect } from "next/navigation";
import styles from "../../../vendors/page.module.css";

type ProjectActivityPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectActivityPage({ params }: ProjectActivityPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Project Activity</h1>
          <p>
            Read-only timeline for cross-domain activity. It merges financial audit events with
            workflow status history for this project.
          </p>
          <p>
            Use category filters to focus on finance-only events or workflow-only events while
            keeping drill-down links available.
          </p>
        </header>
        <section className={styles.card}>
          <ProjectActivityConsole projectId={Number(projectId)} />
        </section>
      </main>
    </div>
  );
}
