"use client";

/**
 * Receipts tab — org-wide receipt browser for the accounting page.
 *
 * Shows all receipts across projects. Receipts serve as "selector documents"
 * for creating or allocating outbound payments.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";
import { formatDateDisplay } from "@/shared/date-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import styles from "./accounting-console.module.css";

type ReceiptRecord = {
  id: number;
  project: number;
  project_name: string;
  store: number | null;
  store_name: string;
  amount: string;
  balance_due: string;
  receipt_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

function formatMoney(val: string): string {
  const n = Number(val);
  if (Number.isNaN(n)) return val;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ReceiptsTab({
  token,
  baseUrl,
}: {
  token: string;
  baseUrl: string;
}) {
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${normalizeApiBaseUrl(baseUrl)}/receipts/`, {
        headers: buildAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        setReceipts(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return receipts;
    const q = search.trim().toLowerCase();
    return receipts.filter(
      (r) =>
        r.store_name.toLowerCase().includes(q) ||
        r.project_name.toLowerCase().includes(q) ||
        r.amount.includes(q) ||
        r.notes.toLowerCase().includes(q),
    );
  }, [receipts, search]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  if (loading) {
    return <p className={styles.loadingText}>Loading receipts...</p>;
  }

  return (
    <div>
      <div className={styles.filterBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search receipts..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No receipts found.</p>
      ) : (
        <>
          <div className={styles.documentList}>
            {paginatedItems.map((r) => (
              <div key={r.id} className={styles.documentRow}>
                <div className={styles.documentIdentity}>
                  <div className={styles.documentPrimary}>
                    <span>{r.store_name || "Receipt"}</span>
                  </div>
                  <div className={styles.documentSecondary}>
                    <span>{r.project_name}</span>
                    <span>{formatDateDisplay(r.receipt_date)}</span>
                    {r.notes ? <span>{r.notes.length > 40 ? `${r.notes.slice(0, 40)}...` : r.notes}</span> : null}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className={styles.documentAmount}>{formatMoney(r.amount)}</div>
                  {Number(r.balance_due) > 0 && Number(r.balance_due) < Number(r.amount) ? (
                    <div className={styles.documentBalance}>
                      {formatMoney(r.balance_due)} due
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {totalPages > 1 ? (
            <PaginationControls page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  );
}
