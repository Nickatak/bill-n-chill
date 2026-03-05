import type { Metadata } from "next";
import { ProjectActivityConsole } from "@/features/projects/components/project-activity-console";
import Link from "next/link";
import { redirect } from "next/navigation";
import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/shared/shell/route-metadata";

type ProjectAuditTrailPageProps = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata({ params }: ProjectAuditTrailPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Audit Trail", "Project Audit Trail") };
}

export default async function ProjectAuditTrailPage({ params }: ProjectAuditTrailPageProps) {
  const { projectId } = await params;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }

  return (
    <PageShell>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Projects</p>
          <h1 className={shell.title}>Audit Trail</h1>
          <p className={shell.copy}>
            Read-only audit trail combining workflow transitions and finance-linked
            audit events for a single project.
          </p>
        </div>
        <div className={shell.linkRow}>
          <Link className={shell.linkButton} href={`/projects?project=${projectId}`}>
            Back to Project Hub
          </Link>
          <Link className={shell.linkButton} href="/invoices">
            Next: Invoices
          </Link>
        </div>
      </header>
      <PageCard>
        <ProjectActivityConsole projectId={Number(projectId)} />
      </PageCard>
    </PageShell>
  );
}
