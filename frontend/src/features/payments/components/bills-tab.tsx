"use client";

/**
 * Bills tab — org-wide vendor bill browser for the accounting page.
 *
 * Shows all vendor bills across projects. Bills serve as "selector documents"
 * for creating or allocating outbound payments.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";
import { formatDateDisplay } from "@/shared/date-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import type { VendorBillRecord } from "@/features/vendor-bills/types";
import styles from "./accounting-console.module.css";

const STATUS_CLASS: Record<string, string> = {
  received: styles.statusReceived,
  approved: styles.statusApproved,
  disputed: styles.statusDisputed,
  closed: styles.statusClosed,
  void: styles.statusVoid,
};

function formatMoney(val: string): string {
  const n = Number(val);
  if (Number.isNaN(n)) return val;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BillsTab({
  token,
  baseUrl,
}: {
  token: string;
  baseUrl: string;
}) {
  const [bills, setBills] = useState<VendorBillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${normalizeApiBaseUrl(baseUrl)}/vendor-bills/`, {
        headers: buildAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        setBills(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return bills;
    const q = search.trim().toLowerCase();
    return bills.filter(
      (b) =>
        b.vendor_name.toLowerCase().includes(q) ||
        b.bill_number.toLowerCase().includes(q) ||
        b.project_name.toLowerCase().includes(q) ||
        b.total.includes(q),
    );
  }, [bills, search]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  if (loading) {
    return <p className={styles.loadingText}>Loading bills...</p>;
  }

  return (
    <div>
      <div className={styles.filterBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search bills..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No vendor bills found.</p>
      ) : (
        <>
          <div className={styles.documentList}>
            {paginatedItems.map((b) => (
              <div key={b.id} className={styles.documentRow}>
                <div className={styles.documentIdentity}>
                  <div className={styles.documentPrimary}>
                    <span className={STATUS_CLASS[b.status] ?? ""}>{b.status}</span>
                    <span>{b.vendor_name}</span>
                    {b.bill_number ? <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>#{b.bill_number}</span> : null}
                  </div>
                  <div className={styles.documentSecondary}>
                    <span>{b.project_name}</span>
                    {b.due_date ? <span>Due {formatDateDisplay(b.due_date)}</span> : null}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className={styles.documentAmount}>{formatMoney(b.total)}</div>
                  {Number(b.balance_due) > 0 && Number(b.balance_due) < Number(b.total) ? (
                    <div className={styles.documentBalance}>
                      {formatMoney(b.balance_due)} due
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
