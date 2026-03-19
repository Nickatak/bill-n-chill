"use client";

/**
 * Receipts tab — org-wide receipt browser for the accounting page.
 *
 * Shows all receipts across projects. Rows expand inline to show
 * attached payments and a form to record a new outbound payment against
 * the receipt. Creating a payment auto-allocates it to the receipt.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";
import { formatDateDisplay, todayDateInput } from "@/shared/date-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import styles from "./accounting-console.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReceiptAllocationRecord = {
  id: number;
  payment: number;
  applied_amount: string;
  payment_date: string;
  payment_method: string;
  payment_status: string;
  payment_reference: string;
  created_at: string;
};

type ReceiptRecord = {
  id: number;
  project: number;
  project_name: string;
  store: number | null;
  store_name: string;
  amount: string;
  balance_due: string;
  allocations: ReceiptAllocationRecord[];
  receipt_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_CLASS: Record<string, string> = {
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

const METHOD_OPTIONS = Object.entries(METHOD_LABELS);

function formatMoney(val: string): string {
  const n = Number(val);
  if (Number.isNaN(n)) return val;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// New payment form state
// ---------------------------------------------------------------------------

type NewPaymentForm = {
  amount: string;
  method: string;
  payment_date: string;
  reference_number: string;
  notes: string;
};

function defaultPaymentForm(balanceDue: string): NewPaymentForm {
  const balance = Number(balanceDue);
  return {
    amount: balance > 0 ? balanceDue : "",
    method: "card",
    payment_date: todayDateInput(),
    reference_number: "",
    notes: "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReceiptsTab({
  token,
  baseUrl,
  isMobile: _isMobile,
}: {
  token: string;
  baseUrl: string;
  isMobile: boolean;
}) {
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Expand state
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>("");
  const [paymentForm, setPaymentForm] = useState<NewPaymentForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"success" | "error">("success");

  const apiBase = normalizeApiBaseUrl(baseUrl);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/receipts/`, {
        headers: buildAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        setReceipts(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const handleSelectReceipt = useCallback(
    (r: ReceiptRecord) => {
      const id = String(r.id);
      if (selectedReceiptId === id) {
        setSelectedReceiptId("");
        setPaymentForm(null);
        setActionMessage("");
      } else {
        setSelectedReceiptId(id);
        setPaymentForm(defaultPaymentForm(r.balance_due));
        setActionMessage("");
      }
    },
    [selectedReceiptId],
  );

  const selectedReceipt = useMemo(
    () => receipts.find((r) => String(r.id) === selectedReceiptId) ?? null,
    [receipts, selectedReceiptId],
  );

  // -------------------------------------------------------------------------
  // Record payment
  // -------------------------------------------------------------------------

  const updateField = useCallback(
    (field: keyof NewPaymentForm, value: string) => {
      setPaymentForm((prev) => (prev ? { ...prev, [field]: value } : prev));
      setActionMessage("");
    },
    [],
  );

  const handleRecordPayment = useCallback(async () => {
    if (!paymentForm || !selectedReceipt) return;

    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) {
      setActionMessage("Enter a payment amount.");
      setActionTone("error");
      return;
    }
    if (!paymentForm.payment_date) {
      setActionMessage("Payment date is required.");
      setActionTone("error");
      return;
    }

    const balanceDue = Number(selectedReceipt.balance_due);
    if (amount > balanceDue) {
      setActionMessage(`Amount exceeds balance due (${formatMoney(selectedReceipt.balance_due)}).`);
      setActionTone("error");
      return;
    }

    setSaving(true);
    setActionMessage("");

    try {
      // Step 1: Create the outbound payment
      const createRes = await fetch(`${apiBase}/payments/`, {
        method: "POST",
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "outbound",
          method: paymentForm.method,
          status: "settled",
          amount: paymentForm.amount,
          payment_date: paymentForm.payment_date,
          reference_number: paymentForm.reference_number,
          notes: paymentForm.notes,
          project: selectedReceipt.project,
        }),
      });
      const createJson = await createRes.json();

      if (!createRes.ok) {
        setActionMessage(createJson.error?.message ?? "Failed to create payment.");
        setActionTone("error");
        return;
      }

      const paymentId = createJson.data?.id;

      // Step 2: Allocate to this receipt
      const allocateRes = await fetch(`${apiBase}/payments/${paymentId}/allocate/`, {
        method: "POST",
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: [
            {
              target_type: "receipt",
              target_id: selectedReceipt.id,
              applied_amount: paymentForm.amount,
            },
          ],
        }),
      });
      const allocateJson = await allocateRes.json();

      if (!allocateRes.ok) {
        setActionMessage(allocateJson.error?.message ?? "Payment created but allocation failed.");
        setActionTone("error");
        void load();
        return;
      }

      // Success — reload receipts to get updated balances and allocations
      setActionMessage("Payment recorded and applied.");
      setActionTone("success");
      await load();

      // Re-select the receipt and reset the form with updated balance
      const refreshedReceipt = receipts.find((r) => r.id === selectedReceipt.id);
      if (refreshedReceipt) {
        setPaymentForm(defaultPaymentForm(refreshedReceipt.balance_due));
      }
    } catch {
      setActionMessage("Network error — could not record payment.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [paymentForm, selectedReceipt, apiBase, token, load, receipts]);

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  function renderAllocations(allocations: ReceiptAllocationRecord[]) {
    if (allocations.length === 0) {
      return <p className={styles.allocationMeta}>No payments recorded yet.</p>;
    }
    return (
      <div className={styles.allocationList}>
        {allocations.map((a) => (
          <div key={a.id} className={styles.allocationRow}>
            <div>
              <span className={styles.allocationTarget}>
                {METHOD_LABELS[a.payment_method] ?? a.payment_method}
              </span>
              <span className={styles.allocationMeta}>
                {" "}{formatDateDisplay(a.payment_date)}
                {a.payment_reference ? ` · Ref: ${a.payment_reference}` : ""}
              </span>
              {" "}
              {a.payment_status !== "settled" ? <span className={PAYMENT_STATUS_CLASS[a.payment_status] ?? ""}>{a.payment_status}</span> : null}
            </div>
            <span className={styles.allocationAmount}>{formatMoney(a.applied_amount)}</span>
          </div>
        ))}
      </div>
    );
  }

  function renderExpanded(r: ReceiptRecord) {
    if (!paymentForm) return null;
    const balanceDue = Number(r.balance_due);
    const canRecordPayment = balanceDue > 0;

    return (
      <div className={styles.paymentExpandedSections} onClick={(e) => e.stopPropagation()}>
        {/* Existing payments */}
        <div className={styles.paymentSection}>
          <h4 className={styles.paymentSectionHeading}>
            Payments ({r.allocations.length})
          </h4>
          <div className={styles.paymentSectionContent}>
            {renderAllocations(r.allocations)}
          </div>
        </div>

        {/* Record new payment */}
        {canRecordPayment ? (
          <div className={styles.paymentSection}>
            <h4 className={styles.paymentSectionHeading}>Record Payment</h4>
            <div className={styles.paymentSectionContent}>
              <div className={styles.paymentFieldGrid}>
                <label className={styles.paymentField}>
                  Amount
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={r.balance_due}
                    value={paymentForm.amount}
                    onChange={(e) => updateField("amount", e.target.value)}
                    disabled={saving}
                    placeholder={`Up to ${formatMoney(r.balance_due)}`}
                  />
                </label>
                <label className={styles.paymentField}>
                  Method
                  <select
                    value={paymentForm.method}
                    onChange={(e) => updateField("method", e.target.value)}
                    disabled={saving}
                  >
                    {METHOD_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.paymentField}>
                  Payment Date
                  <input
                    type="date"
                    value={paymentForm.payment_date}
                    onChange={(e) => updateField("payment_date", e.target.value)}
                    disabled={saving}
                  />
                </label>
                <label className={styles.paymentField}>
                  Reference #
                  <input
                    type="text"
                    value={paymentForm.reference_number}
                    onChange={(e) => updateField("reference_number", e.target.value)}
                    disabled={saving}
                    placeholder="Check #, transaction ID, etc."
                  />
                </label>
              </div>
              <label className={styles.paymentFieldFull}>
                Notes
                <textarea
                  value={paymentForm.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  disabled={saving}
                  placeholder="Optional notes about this payment."
                  rows={2}
                />
              </label>

              {actionMessage ? (
                <p
                  className={actionTone === "error" ? styles.paymentActionError : styles.paymentActionSuccess}
                  role="status"
                >
                  {actionMessage}
                </p>
              ) : null}

              <div className={styles.paymentActionRow}>
                <button
                  type="button"
                  className={styles.paymentActionButtonPrimary}
                  onClick={handleRecordPayment}
                  disabled={saving}
                >
                  {saving ? "Recording..." : "Record Payment"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

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
            {paginatedItems.map((r) => {
              const isSelected = String(r.id) === selectedReceiptId;
              return (
                <article
                  key={r.id}
                  className={`${styles.paymentRow} ${isSelected ? styles.paymentRowSelected : ""}`}
                  onClick={() => handleSelectReceipt(r)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectReceipt(r);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                >
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
                    ) : Number(r.balance_due) <= 0 && Number(r.amount) > 0 ? (
                      <div className={styles.documentBalance}>Paid</div>
                    ) : null}
                  </div>

                  {isSelected && selectedReceipt ? renderExpanded(selectedReceipt) : null}
                </article>
              );
            })}
          </div>
          {totalPages > 1 ? (
            <PaginationControls page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  );
}
