"use client";

/**
 * Tabbed quick-entry panel for the projects page.
 *
 * Offers two tabs — "Customer Payment" (inbound payment recorder) and
 * "Log Expense" (quick expense form) — so users can record cash-in or
 * expenses without leaving the project hub.
 *
 * Parent: ProjectsConsole
 */

import { useState } from "react";
import { PaymentRecorder, type AllocationTarget } from "@/features/payments";
import { QuickExpense } from "@/features/vendor-bills/components/quick-expense";
import styles from "./quick-entry-tabs.module.css";

type QuickEntryTab = "payment" | "expense";

type QuickEntryTabsProps = {
  projectId: number;
  authToken: string;
  allocationTargets: AllocationTarget[];
  onPaymentsChanged?: () => void;
  onExpenseCreated?: () => void;
};

export function QuickEntryTabs({
  projectId,
  authToken,
  allocationTargets,
  onPaymentsChanged,
  onExpenseCreated,
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
          className={`${styles.tab} ${activeTab === "expense" ? styles.tabActive : styles.tabInactive}`}
          aria-pressed={activeTab === "expense"}
          onClick={() => setActiveTab("expense")}
        >
          Log Expense
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
          <QuickExpense
            projectId={projectId}
            authToken={authToken}
            onExpenseCreated={onExpenseCreated}
          />
        )}
      </div>
    </div>
  );
}
