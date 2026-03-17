"use client";

/**
 * Accounting console — tabbed hub for payments, bills, and receipts.
 *
 * Tab 1: Payments — org-wide ledger showing all inbound + outbound payments.
 * Tab 2: Bills — org-wide vendor bill browser (selector documents for outbound payments).
 * Tab 3: Receipts — org-wide receipt browser (selector documents for outbound payments).
 *
 * URL stays at /accounting (no sub-routes). Tab state is local.
 */

import { useState } from "react";

import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { defaultApiBaseUrl } from "@/shared/api/base";

import { PaymentsLedgerTab } from "./payments-ledger-tab";
import { BillsTab } from "./bills-tab";
import { ReceiptsTab } from "./receipts-tab";
import styles from "./accounting-console.module.css";

type AccountingTab = "payments" | "bills" | "receipts";

const TABS: Array<{ key: AccountingTab; label: string }> = [
  { key: "payments", label: "Payments" },
  { key: "bills", label: "Bills" },
  { key: "receipts", label: "Receipts" },
];

export function AccountingConsole() {
  const { token } = useSharedSessionAuth();
  const [activeTab, setActiveTab] = useState<AccountingTab>("payments");

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
        {activeTab === "payments" ? (
          <PaymentsLedgerTab token={token} baseUrl={defaultApiBaseUrl} />
        ) : null}
        {activeTab === "bills" ? (
          <BillsTab token={token} baseUrl={defaultApiBaseUrl} />
        ) : null}
        {activeTab === "receipts" ? (
          <ReceiptsTab token={token} baseUrl={defaultApiBaseUrl} />
        ) : null}
      </div>
    </div>
  );
}
