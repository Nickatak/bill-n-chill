import type { Metadata } from "next";
import { VendorBillsConsole } from "@/features/vendor-bills";
import { PageCard, PageShell } from "@/app/page-shell";
import { resolveProjectQueryTitle } from "@/app/route-metadata";

type BillsPageMetadataProps = {
  searchParams: Promise<{ project?: string }>;
};

export async function generateMetadata({ searchParams }: BillsPageMetadataProps): Promise<Metadata> {
  const { project } = await searchParams;
  return { title: resolveProjectQueryTitle("Bills", project) };
}

export default function BillsPage() {
  return (
    <PageShell>
      <PageCard>
        <VendorBillsConsole />
      </PageCard>
    </PageShell>
  );
}
