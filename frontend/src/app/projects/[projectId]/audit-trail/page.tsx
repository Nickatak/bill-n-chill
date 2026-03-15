// TODO: Audit trail is hidden from the UI for now (no nav link points here).
// This will resurface as an administration/compliance feature. The route,
// component, and backend endpoints are fully functional — just not exposed.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/shared/shell/route-metadata";
import { ProjectActivityConsole } from "@/features/projects/components/project-activity-console";

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
      <PageCard>
        <ProjectActivityConsole projectId={Number(projectId)} />
      </PageCard>
    </PageShell>
  );
}
