/**
 * Accounting page — tabbed hub for invoices and bills.
 *
 * Tab 1: Invoices — AR invoice browser.
 * Tab 2: Bills — vendor bill browser (includes quick expenses).
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
