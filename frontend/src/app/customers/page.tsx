import type { Metadata } from "next";
import { CustomersConsole } from "@/features/customers";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Customers",
};

/** Route page for the customers list with quick-add. */
export default function CustomersPage() {
  return (
    <PageShell>
      <PageCard>
        <CustomersConsole />
      </PageCard>
    </PageShell>
  );
}
