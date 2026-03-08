import type { Metadata } from "next";
import { VendorBillsConsole } from "@/features/vendor-bills";
import { PageCard, PageShell } from "@/shared/shell";
import { resolveProjectQueryTitle } from "@/shared/shell/route-metadata";

type BillsPageMetadataProps = {
  searchParams: Promise<{ project?: string }>;
};

export async function generateMetadata({ searchParams }: BillsPageMetadataProps): Promise<Metadata> {
  const { project } = await searchParams;
  return { title: resolveProjectQueryTitle("Bills", project) };
}

/** Route page for the vendor bills list. */
export default function BillsPage() {
  return (
    <PageShell>
      <PageCard>
        <VendorBillsConsole />
      </PageCard>
    </PageShell>
  );
}
