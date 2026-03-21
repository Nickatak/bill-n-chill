"use client";

/**
 * Accounting console — tabbed hub for AR (invoices), AP (bills), and receipts.
 *
 * Minimal orchestrator — owns only tab state. Each tab component is
 * self-contained with its own data fetching and mutation logic.
 *
 * Parent: app/accounting/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────┐
 * │ Tab bar (Invoices / Bills / Rcpts)  │
 * ├─────────────────────────────────────┤
 * │ Tab content (one at a time):        │
 * │   ├── InvoicesTab                   │
 * │   ├── BillsTab                      │
 * │   └── ReceiptsTab                   │
 * └─────────────────────────────────────┘
 *
 * ## State (useState)
 *
 * - activeTab — "invoices" | "bills" | "receipts"
 */

import { useState } from "react";

import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { defaultApiBaseUrl } from "@/shared/api/base";
import { useMediaQuery } from "@/shared/hooks/use-media-query";

import { InvoicesTab } from "./invoices-tab";
import { BillsTab } from "./bills-tab";
import { ReceiptsTab } from "./receipts-tab";
import styles from "./accounting-console.module.css";

type AccountingTab = "invoices" | "bills" | "receipts";

const TABS: Array<{ key: AccountingTab; label: string }> = [
  { key: "invoices", label: "Invoices" },
  { key: "bills", label: "Bills" },
  { key: "receipts", label: "Receipts" },
];

export function AccountingConsole() {
  const { token: authToken } = useSharedSessionAuth();
  const [activeTab, setActiveTab] = useState<AccountingTab>("invoices");
  const isMobile = useMediaQuery("(max-width: 700px)");

  if (!authToken) {
    return <p className={styles.authNotice}>Sign in to view accounting data.</p>;
  }

  return (
    <div className={styles.console}>
      <div className={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeTab === "invoices" ? (
          <InvoicesTab authToken={authToken} baseUrl={defaultApiBaseUrl} isMobile={isMobile} />
        ) : null}
        {activeTab === "bills" ? (
          <BillsTab authToken={authToken} baseUrl={defaultApiBaseUrl} isMobile={isMobile} />
        ) : null}
        {activeTab === "receipts" ? (
          <ReceiptsTab authToken={authToken} baseUrl={defaultApiBaseUrl} isMobile={isMobile} />
        ) : null}
      </div>
    </div>
  );
}
