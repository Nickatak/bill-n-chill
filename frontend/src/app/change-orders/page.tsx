import type { Metadata } from "next";
import { ChangeOrdersConsole } from "@/features/change-orders";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Change Orders",
};

export default function ChangeOrdersPage() {
  return (
    <PageShell>
      <PageCard>
        <ChangeOrdersConsole />
      </PageCard>
    </PageShell>
  );
}
