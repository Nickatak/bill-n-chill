/**
 * Accounting page — org-wide ledger for reconciliation and payment management.
 *
 * Both inbound (from customers) and outbound (to vendors) payments are visible
 * here with a direction toggle. Day-to-day payment recording lives on the
 * project page; this is the bookkeeper's reconciliation view.
 *
 * See docs/decisions/product-direction-refinement.md for strategic context.
 */

import type { Metadata } from "next";
import { PageShell } from "@/shared/shell";
import { PaymentsConsole } from "@/features/payments";

export const metadata: Metadata = {
  title: "Accounting",
};

export default function AccountingPage() {
  return (
    <PageShell>
      <PaymentsConsole />
    </PageShell>
  );
}
