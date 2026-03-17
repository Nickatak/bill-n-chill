/**
 * Accounting page — tabbed hub for payments, bills, and receipts.
 *
 * Tab 1: Payments — org-wide ledger (inbound + outbound).
 * Tab 2: Bills — vendor bill browser (selector documents for outbound payments).
 * Tab 3: Receipts — receipt browser (selector documents for outbound payments).
 *
 * Day-to-day payment recording lives on the project page via Quick Pay.
 * See docs/decisions/accounting-page-redesign.md for strategic context.
 */

import type { Metadata } from "next";
import { PageShell } from "@/shared/shell";
import { AccountingConsole } from "@/features/payments";

export const metadata: Metadata = {
  title: "Accounting",
};

export default function AccountingPage() {
  return (
    <PageShell>
      <AccountingConsole />
    </PageShell>
  );
}
