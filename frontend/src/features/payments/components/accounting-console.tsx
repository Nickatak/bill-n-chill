"use client";

/**
 * Accounting console — tabbed hub for invoices (AR), bills (AP), and receipts.
 *
 * Tab 1: Invoices — org-wide invoice browser with inline payment recording (AR).
 * Tab 2: Bills — org-wide vendor bill browser with inline payment recording (AP).
 * Tab 3: Receipts — org-wide receipt browser with inline payment recording (AP).
 *
 * Every payment is anchored to a document — no standalone payment view.
 * URL stays at /accounting (no sub-routes). Tab state is local.
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
  const { token } = useSharedSessionAuth();
  const [activeTab, setActiveTab] = useState<AccountingTab>("invoices");
  const isMobile = useMediaQuery("(max-width: 700px)");

  if (!token) {
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
          <InvoicesTab token={token} baseUrl={defaultApiBaseUrl} isMobile={isMobile} />
        ) : null}
        {activeTab === "bills" ? (
          <BillsTab token={token} baseUrl={defaultApiBaseUrl} isMobile={isMobile} />
        ) : null}
        {activeTab === "receipts" ? (
          <ReceiptsTab token={token} baseUrl={defaultApiBaseUrl} isMobile={isMobile} />
        ) : null}
      </div>
    </div>
  );
}
