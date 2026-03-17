"use client";

/**
 * Payments ledger tab — org-wide view of all payments (inbound + outbound).
 *
 * Shows a compact list of all payments with direction, status, and allocation info.
 * Filterable by direction and status.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";
import { formatDateDisplay } from "@/shared/date-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import type { PaymentRecord } from "../types";
import styles from "./accounting-console.module.css";

type DirectionFilter = "all" | "inbound" | "outbound";
type StatusFilter = "all" | "pending" | "settled" | "void";

const DIRECTION_FILTERS: Array<{ key: DirectionFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "inbound", label: "Inbound" },
  { key: "outbound", label: "Outbound" },
];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "settled", label: "Settled" },
  { key: "void", label: "Void" },
];

const DIRECTION_CLASS: Record<string, string> = {
  inbound: styles.directionInbound,
  outbound: styles.directionOutbound,
};

const STATUS_CLASS: Record<string, string> = {
  pending: styles.statusPending,
  settled: styles.statusSettled,
  void: styles.statusVoid,
};

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  zelle: "Zelle",
  ach: "ACH",
  cash: "Cash",
  wire: "Wire",
  card: "Card",
  other: "Other",
};

function formatMoney(val: string): string {
  const n = Number(val);
  if (Number.isNaN(n)) return val;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentsLedgerTab({
  token,
  baseUrl,
}: {
  token: string;
  baseUrl: string;
}) {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${normalizeApiBaseUrl(baseUrl)}/payments/`, {
        headers: buildAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        setPayments(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    let result = payments;
    if (directionFilter !== "all") {
      result = result.filter((p) => p.direction === directionFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.customer_name.toLowerCase().includes(q) ||
          p.project_name.toLowerCase().includes(q) ||
          p.reference_number.toLowerCase().includes(q) ||
          p.amount.includes(q) ||
          (METHOD_LABELS[p.method] ?? p.method).toLowerCase().includes(q),
      );
    }
    return result;
  }, [payments, directionFilter, statusFilter, search]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  if (loading) {
    return <p className={styles.loadingText}>Loading payments...</p>;
  }

  return (
    <div>
      {/* Filters */}
      <div className={styles.filterBar}>
        {DIRECTION_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`${styles.filterPill} ${directionFilter === f.key ? styles.filterPillActive : ""}`}
            onClick={() => { setDirectionFilter(f.key); setPage(1); }}
          >
            {f.label}
          </button>
        ))}
        <span style={{ width: 1, height: 16, background: "var(--border)", flexShrink: 0 }} />
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`${styles.filterPill} ${statusFilter === f.key ? styles.filterPillActive : ""}`}
            onClick={() => { setStatusFilter(f.key); setPage(1); }}
          >
            {f.label}
          </button>
        ))}
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search payments..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {/* Payment list */}
      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No payments match the current filters.</p>
      ) : (
        <>
          <div className={styles.documentList}>
            {paginatedItems.map((p) => (
              <div key={p.id} className={styles.documentRow}>
                <div className={styles.documentIdentity}>
                  <div className={styles.documentPrimary}>
                    <span className={DIRECTION_CLASS[p.direction] ?? ""}>{p.direction}</span>
                    <span className={STATUS_CLASS[p.status] ?? ""}>{p.status}</span>
                    <span>{p.customer_name || p.project_name || "Unassigned"}</span>
                  </div>
                  <div className={styles.documentSecondary}>
                    {p.project_name ? <span>{p.project_name}</span> : null}
                    <span>{METHOD_LABELS[p.method] ?? p.method}</span>
                    <span>{formatDateDisplay(p.payment_date)}</span>
                    {p.reference_number ? <span>Ref: {p.reference_number}</span> : null}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className={styles.documentAmount}>{formatMoney(p.amount)}</div>
                  {Number(p.unapplied_amount) > 0 ? (
                    <div className={styles.documentBalance}>
                      {formatMoney(p.unapplied_amount)} unapplied
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
