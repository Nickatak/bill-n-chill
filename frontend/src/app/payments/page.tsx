/**
 * Payments page — placeholder.
 *
 * Payments is a first-class workflow item for recording money in (from customers)
 * and money out (to vendors/subs). Previously, payment recording was embedded in
 * the Invoices and Bills pages as a secondary feature.
 *
 * See docs/decisions/product-direction-refinement.md for the strategic context
 * behind promoting Payments to its own route.
 */

import type { Metadata } from "next";
import { PageShell } from "@/shared/shell";

export const metadata: Metadata = {
  title: "Payments",
};

export default function PaymentsPage() {
  return (
    <PageShell>
      <h1>Payments</h1>
      <p>Coming soon.</p>
    </PageShell>
  );
}
