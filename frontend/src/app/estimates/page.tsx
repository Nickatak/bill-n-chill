import { redirect } from "next/navigation";

type EstimatesPageProps = {
  searchParams: Promise<{ project?: string; estimate?: string }>;
};

export default async function EstimatesPage({ searchParams }: EstimatesPageProps) {
  const { project, estimate } = await searchParams;
  if (!project || !/^\d+$/.test(project)) {
    redirect("/estimates-placeholder");
  }
  const estimateQuery = estimate && /^\d+$/.test(estimate) ? `?estimate=${estimate}` : "";
  redirect(`/projects/${project}/estimates${estimateQuery}`);
}
