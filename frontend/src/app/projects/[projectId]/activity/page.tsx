import { ProjectActivityConsole } from "@/features/projects/components/project-activity-console";
import Link from "next/link";
import { redirect } from "next/navigation";
import shell from "@/app/wip-shell.module.css";

type ProjectActivityPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectActivityPage({ params }: ProjectActivityPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }

  return (
    <div className={shell.page}>
      <main className={shell.main}>
        <header className={shell.hero}>
          <div className={shell.heroTop}>
            <p className={shell.eyebrow}>Projects</p>
            <h1 className={shell.title}>Project Activity (WIP)</h1>
            <p className={shell.copy}>
              Read-only activity timeline that combines workflow transitions and finance-linked
              audit events for a single project.
            </p>
          </div>
          <div className={shell.linkRow}>
            <Link className={shell.linkButton} href={`/projects?project=${projectId}`}>
              Back to Project Hub
            </Link>
            <Link className={shell.linkButton} href="/financials-auditing">
              Next: Financials & Accounting
            </Link>
          </div>
        </header>
        <section className={shell.card}>
          <ProjectActivityConsole projectId={Number(projectId)} />
        </section>
      </main>
    </div>
  );
}
