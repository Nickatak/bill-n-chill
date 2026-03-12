/**
 * Payments page — first-class workflow page for recording and managing payments.
 *
 * Both inbound (from customers) and outbound (to vendors) payments are visible
 * here with a direction toggle. Outbound payments also remain co-located on the
 * Bills page for convenience.
 *
 * See docs/decisions/product-direction-refinement.md for strategic context.
 */

import type { Metadata } from "next";
import { PageShell } from "@/shared/shell";
import { PaymentsConsole } from "@/features/payments";

export const metadata: Metadata = {
  title: "Payments",
};

export default function PaymentsPage() {
  return (
    <PageShell>
      <PaymentsConsole />
    </PageShell>
  );
}
