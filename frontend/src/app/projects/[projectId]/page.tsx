import { redirect } from "next/navigation";

type ProjectIndexRedirectPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectIndexRedirectPage({ params }: ProjectIndexRedirectPageProps) {
  const { projectId } = await params;
  if (!/^\d+$/.test(projectId)) {
    redirect("/projects");
  }
  redirect(`/projects?project=${projectId}`);
}
