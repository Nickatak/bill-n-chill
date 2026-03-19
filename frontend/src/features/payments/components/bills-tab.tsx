"use client";

/**
 * Bills tab — org-wide vendor bill browser for the accounting page.
 *
 * Shows all vendor bills across projects. Rows expand inline to show
 * attached payments and a form to record a new outbound payment against
 * the bill. Creating a payment auto-allocates it to the bill.
 *
 * Desktop: dense document list (grid rows).
 * Mobile:  card list with summary banner, collapsible search.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";
import { formatDateDisplay, todayDateInput } from "@/shared/date-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import type { VendorBillRecord, VendorBillAllocationRecord } from "@/features/vendor-bills/types";
import styles from "./accounting-console.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BILL_STATUS_CLASS: Record<string, string> = {
  received: styles.statusReceived,
  approved: styles.statusApproved,
  disputed: styles.statusDisputed,
  closed: styles.statusClosed,
  void: styles.statusVoid,
};

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

/** Methods where a reference # is expected for traceability. */
const METHODS_EXPECTING_REFERENCE = new Set(["check", "ach", "wire", "card"]);

function hasMissingReference(allocations: VendorBillAllocationRecord[]): boolean {
  return allocations.some(
    (a) => !a.payment_reference && METHODS_EXPECTING_REFERENCE.has(a.payment_method),
  );
}

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
    method: "check",
    payment_date: todayDateInput(),
    reference_number: "",
    notes: "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BillsTab({
  token,
  baseUrl,
  isMobile,
}: {
  token: string;
  baseUrl: string;
  isMobile: boolean;
}) {
  const [bills, setBills] = useState<VendorBillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hideVoided, setHideVoided] = useState(true);
  const [filterUnpaid, setFilterUnpaid] = useState(true);

  // Expand state
  const [selectedBillId, setSelectedBillId] = useState<string>("");
  const [paymentForm, setPaymentForm] = useState<NewPaymentForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"success" | "error">("success");

  const apiBase = normalizeApiBaseUrl(baseUrl);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/vendor-bills/`, {
        headers: buildAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        setBills(json.data ?? []);
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

  const handleSelectBill = useCallback(
    (b: VendorBillRecord) => {
      const id = String(b.id);
      if (selectedBillId === id) {
        setSelectedBillId("");
        setPaymentForm(null);
        setActionMessage("");
      } else {
        setSelectedBillId(id);
        setPaymentForm(defaultPaymentForm(b.balance_due));
        setActionMessage("");
      }
    },
    [selectedBillId],
  );

  const selectedBill = useMemo(
    () => bills.find((b) => String(b.id) === selectedBillId) ?? null,
    [bills, selectedBillId],
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
    if (!paymentForm || !selectedBill) return;

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

    const balanceDue = Number(selectedBill.balance_due);
    if (amount > balanceDue) {
      setActionMessage(`Amount exceeds balance due (${formatMoney(selectedBill.balance_due)}).`);
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
          project: selectedBill.project,
        }),
      });
      const createJson = await createRes.json();

      if (!createRes.ok) {
        setActionMessage(createJson.error?.message ?? "Failed to create payment.");
        setActionTone("error");
        return;
      }

      const paymentId = createJson.data?.id;

      // Step 2: Allocate to this vendor bill
      const allocateRes = await fetch(`${apiBase}/payments/${paymentId}/allocate/`, {
        method: "POST",
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: [
            {
              target_type: "vendor_bill",
              target_id: selectedBill.id,
              applied_amount: paymentForm.amount,
            },
          ],
        }),
      });
      const allocateJson = await allocateRes.json();

      if (!allocateRes.ok) {
        setActionMessage(allocateJson.error?.message ?? "Payment created but allocation failed.");
        setActionTone("error");
        // Reload to at least show the payment was created
        void load();
        return;
      }

      // Success — reload bills to get updated balances and allocations
      setActionMessage("Payment recorded and applied.");
      setActionTone("success");
      await load();

      // Re-select the bill and reset the form with updated balance
      const refreshedBill = bills.find((b) => b.id === selectedBill.id);
      if (refreshedBill) {
        setPaymentForm(defaultPaymentForm(refreshedBill.balance_due));
      }
    } catch {
      setActionMessage("Network error — could not record payment.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [paymentForm, selectedBill, apiBase, token, load, bills]);

  // -------------------------------------------------------------------------
  // Filtering + summary
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let result = bills;
    if (hideVoided) {
      result = result.filter((b) => b.status !== "void" && b.status !== "closed");
    }
    if (filterUnpaid) {
      result = result.filter((b) => b.payment_status !== "paid");
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (b) =>
          b.vendor_name.toLowerCase().includes(q) ||
          b.bill_number.toLowerCase().includes(q) ||
          b.project_name.toLowerCase().includes(q) ||
          b.total.includes(q),
      );
    }
    return result;
  }, [bills, search, hideVoided, filterUnpaid]);

  const summary = useMemo(() => {
    // Summary excludes voided bills to match what the user sees
    const visible = hideVoided ? bills.filter((b) => b.status !== "void" && b.status !== "closed") : bills;
    const unpaid = visible.filter((b) => b.payment_status !== "paid");
    const totalOutstanding = unpaid.reduce((sum, b) => sum + Number(b.balance_due), 0);
    return { unpaidCount: unpaid.length, totalOutstanding };
  }, [bills, hideVoided]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  // -------------------------------------------------------------------------
  // Shared render helpers
  // -------------------------------------------------------------------------

  function renderAllocations(allocations: VendorBillAllocationRecord[]) {
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

  function renderPaymentForm(b: VendorBillRecord) {
    if (!paymentForm) return null;
    const balanceDue = Number(b.balance_due);
    const canRecordPayment = balanceDue > 0 && b.status !== "void";

    return (
      <div className={styles.paymentExpandedSections} onClick={(e) => e.stopPropagation()}>
        {/* Existing payments */}
        <div className={styles.paymentSection}>
          <h4 className={styles.paymentSectionHeading}>
            Payments ({b.allocations.length})
          </h4>
          <div className={styles.paymentSectionContent}>
            {renderAllocations(b.allocations)}
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
                    max={b.balance_due}
                    value={paymentForm.amount}
                    onChange={(e) => updateField("amount", e.target.value)}
                    disabled={saving}
                    placeholder={`Up to ${formatMoney(b.balance_due)}`}
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
  // Desktop row render
  // -------------------------------------------------------------------------

  function renderDesktopRow(b: VendorBillRecord) {
    const isSelected = String(b.id) === selectedBillId;
    return (
      <article
        key={b.id}
        className={`${styles.paymentRow} ${isSelected ? styles.paymentRowSelected : ""}`}
        onClick={() => handleSelectBill(b)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleSelectBill(b);
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
      >
        <div className={styles.documentIdentity}>
          <div className={styles.documentPrimary}>
            <span className={BILL_STATUS_CLASS[b.status] ?? ""}>{b.status}</span>
            <span>{b.vendor_name}</span>
            {b.bill_number ? <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>#{b.bill_number}</span> : null}
          </div>
          <div className={styles.documentSecondary}>
            <span>{b.project_name}</span>
            {b.due_date ? <span>Due {formatDateDisplay(b.due_date)}</span> : null}
            {hasMissingReference(b.allocations) ? (
              <span className={styles.missingReference} title="Payment missing reference #">No ref #</span>
            ) : null}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={styles.documentAmount}>{formatMoney(b.total)}</div>
          {Number(b.balance_due) > 0 && Number(b.balance_due) < Number(b.total) ? (
            <div className={styles.documentBalance}>
              {formatMoney(b.balance_due)} due
            </div>
          ) : Number(b.balance_due) <= 0 && Number(b.total) > 0 ? (
            <div className={styles.documentBalance}>Paid</div>
          ) : null}
        </div>

        {isSelected && selectedBill ? renderPaymentForm(selectedBill) : null}
      </article>
    );
  }

  // -------------------------------------------------------------------------
  // Mobile card render
  // -------------------------------------------------------------------------

  function renderMobileCard(b: VendorBillRecord) {
    const isSelected = String(b.id) === selectedBillId;
    const isPaid = Number(b.balance_due) <= 0 && Number(b.total) > 0;
    const isPartial = Number(b.balance_due) > 0 && Number(b.balance_due) < Number(b.total);

    return (
      <article
        key={b.id}
        className={`${styles.mobileCard} ${isSelected ? styles.mobileCardSelected : ""}`}
        onClick={() => handleSelectBill(b)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleSelectBill(b);
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
      >
        <div className={styles.mobileCardTop}>
          <div className={styles.mobileCardIdentity}>
            <span className={styles.mobileCardVendor}>{b.vendor_name}</span>
            <span className={styles.mobileCardProject}>{b.project_name}</span>
          </div>
          <div className={styles.mobileCardAmountBlock}>
            <span className={styles.mobileCardAmount}>{formatMoney(b.total)}</span>
            {isPartial ? (
              <span className={styles.mobileCardBalanceDue}>{formatMoney(b.balance_due)} due</span>
            ) : isPaid ? (
              <span className={styles.mobileCardBalancePaid}>Paid</span>
            ) : null}
          </div>
        </div>

        <div className={styles.mobileCardMeta}>
          <span className={BILL_STATUS_CLASS[b.status] ?? ""}>{b.status}</span>
          {b.bill_number ? <span>#{b.bill_number}</span> : null}
          {b.due_date ? <span>Due {formatDateDisplay(b.due_date)}</span> : null}
          {hasMissingReference(b.allocations) ? (
            <span className={styles.missingReference} title="Payment missing reference #">No ref #</span>
          ) : null}
        </div>

        {isSelected && selectedBill ? renderPaymentForm(selectedBill) : null}
      </article>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  if (loading) {
    return <p className={styles.loadingText}>Loading bills...</p>;
  }

  return (
    <div>
      {/* Mobile: summary banner — tap "unpaid" to filter */}
      {isMobile ? (
        <div className={styles.summaryBanner}>
          <button
            type="button"
            className={`${styles.summaryBannerButton} ${filterUnpaid ? styles.summaryBannerButtonActive : ""}`}
            onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}
          >
            {summary.unpaidCount} unpaid
          </button>
          <span className={styles.summaryBannerAmount}>
            {formatMoney(String(summary.totalOutstanding))} outstanding
          </span>
        </div>
      ) : null}

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search bills..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        {!isMobile ? (
          <button
            type="button"
            className={`${styles.filterPill} ${filterUnpaid ? styles.filterPillActive : ""}`}
            onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}
          >
            Unpaid only
          </button>
        ) : null}
        <button
          type="button"
          className={`${styles.filterPill} ${hideVoided ? styles.filterPillActive : ""}`}
          onClick={() => { setHideVoided((v) => !v); setPage(1); }}
        >
          Hide closed
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No vendor bills found.</p>
      ) : (
        <>
          {isMobile ? (
            <div className={styles.mobileCardList}>
              {paginatedItems.map((b) => renderMobileCard(b))}
            </div>
          ) : (
            <div className={styles.documentList}>
              {paginatedItems.map((b) => renderDesktopRow(b))}
            </div>
          )}
          {totalPages > 1 ? (
            <PaginationControls page={page} totalPages={totalPages} totalCount={totalCount} onPageChange={setPage} />
          ) : null}
        </>
      )}
    </div>
  );
}
