import type { Metadata } from "next";
import { CostCodesConsole } from "@/features/cost-codes";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Cost Codes",
};

/** Route page for the cost codes management console. */
export default function CostCodesPage() {
  return (
    <PageShell>
      <PageCard>
        <CostCodesConsole />
      </PageCard>
    </PageShell>
  );
}
