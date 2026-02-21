import { redirect } from "next/navigation";

type VendorBillsPageProps = {
  searchParams: Promise<{ project?: string }>;
};

export default async function VendorBillsPage({ searchParams }: VendorBillsPageProps) {
  const { project } = await searchParams;
  if (!project || !/^\d+$/.test(project)) {
    redirect("/projects");
  }
  redirect(`/projects/${project}/vendor-bills`);
}
