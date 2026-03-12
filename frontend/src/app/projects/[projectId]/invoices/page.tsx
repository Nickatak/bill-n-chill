import type { Metadata } from "next";
import { InvoicesConsole } from "@/features/invoices";
import { redirect } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/shared/shell/route-metadata";

type ProjectInvoicesPageProps = {
  params: Promise<{ projectId: string }>;
};

export async function generateMetadata({ params }: ProjectInvoicesPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Invoices", "Project Invoices") };
}

export default async function ProjectInvoicesPage({
  params,
}: ProjectInvoicesPageProps) {
  const { projectId } = await params;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }

  return (
    <PageShell>
      <PageCard>
        <InvoicesConsole scopedProjectId={Number(projectId)} />
      </PageCard>
    </PageShell>
  );
}
