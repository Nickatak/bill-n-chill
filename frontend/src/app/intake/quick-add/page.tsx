import type { Metadata } from "next";
import { QuickAddConsole } from "@/features/intake";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Quick Add Customer",
};

export default function QuickAddPage() {
  return (
    <PageShell>
      <PageCard>
        <QuickAddConsole />
      </PageCard>
    </PageShell>
  );
}
