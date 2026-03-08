import type { Metadata } from "next";
import { VendorsConsole } from "@/features/vendors";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Vendors",
};

/** Route page for the vendors management console. */
export default function VendorsPage() {
  return (
    <PageShell>
      <PageCard>
        <VendorsConsole />
      </PageCard>
    </PageShell>
  );
}
