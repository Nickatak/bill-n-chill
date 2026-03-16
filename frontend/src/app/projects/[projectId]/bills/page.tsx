import type { Metadata } from "next";
import { VendorBillsConsole } from "@/features/vendor-bills";
import { redirect } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/shared/shell/route-metadata";

type ProjectBillsPageProps = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata({ params }: ProjectBillsPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Bills", "Project Bills") };
}

export default async function ProjectBillsPage({
  params,
}: ProjectBillsPageProps) {
  const { projectId } = await params;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }

  return (
    <PageShell>
      <PageCard>
        <VendorBillsConsole scopedProjectId={Number(projectId)} />
      </PageCard>
    </PageShell>
  );
}
