import type { Metadata } from "next";
import { ProjectActivityConsole } from "@/features/projects/components/project-activity-console";
import Link from "next/link";
import { redirect } from "next/navigation";
import shell from "@/app/page-shell.module.css";
import { PageCard, PageShell } from "@/app/page-shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/app/route-metadata";

type ProjectActivityPageProps = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata({ params }: ProjectActivityPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Activity", "Project Activity") };
}

export default async function ProjectActivityPage({ params }: ProjectActivityPageProps) {
  const { projectId } = await params;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }

  return (
    <PageShell>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Projects</p>
          <h1 className={shell.title}>Project Activity</h1>
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
      <PageCard>
        <ProjectActivityConsole projectId={Number(projectId)} />
      </PageCard>
    </PageShell>
  );
}
