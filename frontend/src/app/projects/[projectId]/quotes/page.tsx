import type { Metadata } from "next";
import { QuotesConsole } from "@/features/quotes";
import { redirect } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/shared/shell/route-metadata";

type ProjectQuotesPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ quote?: string }>;
};

export async function generateMetadata({ params }: ProjectQuotesPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Quotes", "Project Quotes") };
}

export default async function ProjectQuotesPage({
  params,
  searchParams,
}: ProjectQuotesPageProps) {
  const { projectId } = await params;
  const { quote } = await searchParams;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }

  const quoteKey = isNumericRouteId(quote) ? quote : "all";

  return (
    <PageShell>
      <PageCard>
        <QuotesConsole scopedProjectId={Number(projectId)} key={`${projectId}-${quoteKey}`} />
      </PageCard>
    </PageShell>
  );
}
