import type { Metadata } from "next";
import { ProjectsConsole } from "@/features/projects";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Projects",
};

/** Route page for the projects list. */
export default function ProjectsPage() {
  return (
    <PageShell>
      <PageCard>
        <ProjectsConsole />
      </PageCard>
    </PageShell>
  );
}
