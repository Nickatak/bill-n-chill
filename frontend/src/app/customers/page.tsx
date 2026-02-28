import type { Metadata } from "next";
import { ContactsConsole } from "@/features/contacts";
import { PageCard, PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Customers",
};

export default function CustomersPage() {
  return (
    <PageShell>
      <PageCard>
        <ContactsConsole />
      </PageCard>
    </PageShell>
  );
}
