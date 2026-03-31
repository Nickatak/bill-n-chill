import type { Metadata } from "next";
import { ChangeOrdersConsole } from "@/features/change-orders";
import { redirect } from "next/navigation";
import { PageCard, PageShell } from "@/shared/shell";
import { isNumericRouteId, resolveProjectParamTitle } from "@/shared/shell/route-metadata";

type ProjectChangeOrdersPageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ origin_quote?: string }>;
};

export async function generateMetadata({ params }: ProjectChangeOrdersPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return { title: resolveProjectParamTitle(projectId, "Change Orders", "Project Change Orders") };
}

export default async function ProjectChangeOrdersPage({
  params,
  searchParams,
}: ProjectChangeOrdersPageProps) {
  const { projectId } = await params;
  const { origin_quote: originQuote } = await searchParams;
  if (!isNumericRouteId(projectId)) {
    redirect("/projects");
  }
  const initialOriginQuoteId =
    isNumericRouteId(originQuote) ? Number(originQuote) : null;

  return (
    <PageShell>
      <PageCard>
        <ChangeOrdersConsole
          scopedProjectId={Number(projectId)}
          initialOriginQuoteId={initialOriginQuoteId}
        />
      </PageCard>
    </PageShell>
  );
}
