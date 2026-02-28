import type { Metadata } from "next";
import { InvoicesConsole } from "@/features/invoices";
import { PageCard, PageShell } from "@/app/page-shell";
import { resolveProjectQueryTitle } from "@/app/route-metadata";

type InvoicesPageMetadataProps = {
  searchParams: Promise<{ project?: string }>;
};

/**
 * Next.js App Router metadata hook for this route.
 * The hook itself stays in `page.tsx` for framework discovery; title logic is delegated to
 * `route-metadata.ts` helpers to keep route shims thin and consistent.
 */
export async function generateMetadata({ searchParams }: InvoicesPageMetadataProps): Promise<Metadata> {
  const { project } = await searchParams;
  return { title: resolveProjectQueryTitle("Invoices", project) };
}

export default function InvoicesPage() {
  return (
    <PageShell>
      <PageCard>
        <InvoicesConsole />
      </PageCard>
    </PageShell>
  );
}
