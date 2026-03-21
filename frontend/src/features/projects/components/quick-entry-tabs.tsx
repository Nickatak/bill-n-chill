"use client";

/**
 * Tabbed quick-entry panel for the projects page.
 *
 * Offers two tabs — "Customer Payment" (inbound payment recorder) and
 * "Expense Receipt" (standalone receipt form) — so users can record
 * cash-in or expense receipts without leaving the project hub.
 *
 * Parent: ProjectsConsole
 */

import { useState } from "react";
import { PaymentRecorder, type AllocationTarget } from "@/features/payments";
import { QuickReceipt } from "@/features/vendor-bills/components/quick-receipt";
import styles from "./quick-entry-tabs.module.css";

type QuickEntryTab = "payment" | "receipt";

type QuickEntryTabsProps = {
  projectId: number;
  token: string;
  allocationTargets: AllocationTarget[];
  onPaymentsChanged?: () => void;
  onReceiptCreated?: () => void;
};

export function QuickEntryTabs({
  projectId,
  token,
  allocationTargets,
  onPaymentsChanged,
  onReceiptCreated,
}: QuickEntryTabsProps) {
  const [activeTab, setActiveTab] = useState<QuickEntryTab>("payment");

  return (
    <div>
      <div className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "payment" ? styles.tabActive : styles.tabInactive}`}
          aria-pressed={activeTab === "payment"}
          onClick={() => setActiveTab("payment")}
        >
          Customer Payment
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "receipt" ? styles.tabActive : styles.tabInactive}`}
          aria-pressed={activeTab === "receipt"}
          onClick={() => setActiveTab("receipt")}
        >
          Expense Receipt
        </button>
      </div>
      <div className={styles.tabContent}>
        {activeTab === "payment" ? (
          <PaymentRecorder
            projectId={projectId}
            direction="inbound"
            allocationTargets={allocationTargets}
            hideHeader
            createOnly
            hideWorkspaceTitle
            onPaymentsChanged={onPaymentsChanged}
          />
        ) : (
          <QuickReceipt
            projectId={projectId}
            token={token}
            onReceiptCreated={onReceiptCreated}
          />
        )}
      </div>
    </div>
  );
}
