import { redirect } from "next/navigation";

type ExpensesPageProps = {
  searchParams: Promise<{ project?: string }>;
};

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const { project } = await searchParams;
  if (!project || !/^\d+$/.test(project)) {
    redirect("/expenses-placeholder");
  }
  redirect(`/projects/${project}/expenses`);
}
