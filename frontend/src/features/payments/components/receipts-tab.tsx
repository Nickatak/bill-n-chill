"use client";

/**
 * Receipts tab — org-wide receipt browser for the accounting page.
 *
 * Receipts render as cards with their payments as child cards below them.
 * Tap a receipt to record a new outbound payment. Tap a payment to edit it.
 *
 * Desktop: dense document list (grid rows) with payment rows nested.
 * Mobile:  card list with search.
 *
 * Parent: AccountingConsole
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

const METHODS_EXPECTING_REFERENCE = new Set(["check", "ach", "wire", "card"]);

function hasMissingReference(allocations: ReceiptAllocationRecord[]): boolean {
  return allocations.some(
    (a) => !a.payment_reference && METHODS_EXPECTING_REFERENCE.has(a.payment_method),
  );
}

function formatMoney(val: string): string {
  const parsed = Number(val);
  if (Number.isNaN(parsed)) return val;
  return `$${parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type PaymentFormState = {
  amount: string;
  method: string;
  payment_date: string;
  reference_number: string;
  notes: string;
};

function defaultNewPaymentForm(balanceDue: string): PaymentFormState {
  const balance = Number(balanceDue);
  return {
    amount: balance > 0 ? balanceDue : "",
    method: "card",
    payment_date: todayDateInput(),
    reference_number: "",
    notes: "",
  };
}

function paymentToForm(a: ReceiptAllocationRecord): PaymentFormState {
  return {
    amount: a.applied_amount,
    method: a.payment_method,
    payment_date: a.payment_date,
    reference_number: a.payment_reference,
    notes: "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SelectedItem =
  | { type: "receipt"; receiptId: string }
  | { type: "payment"; receiptId: string; paymentId: number };

export function ReceiptsTab({
  authToken,
  baseUrl,
  isMobile,
}: {
  authToken: string;
  baseUrl: string;
  isMobile: boolean;
}) {
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterUnpaid, setFilterUnpaid] = useState(false);

  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [form, setForm] = useState<PaymentFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"success" | "error">("success");

  const apiBase = normalizeApiBaseUrl(baseUrl);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/receipts/`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.ok) {
        const json = await res.json();
        setReceipts(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, authToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const handleSelectReceipt = useCallback(
    (r: ReceiptRecord) => {
      const receiptId = String(r.id);
      if (selected?.type === "receipt" && selected.receiptId === receiptId) {
        setSelected(null);
        setForm(null);
        setActionMessage("");
      } else {
        setSelected({ type: "receipt", receiptId });
        setForm(defaultNewPaymentForm(r.balance_due));
        setActionMessage("");
      }
    },
    [selected],
  );

  const handleSelectPayment = useCallback(
    (receiptId: string, a: ReceiptAllocationRecord) => {
      if (selected?.type === "payment" && (selected as { paymentId: number }).paymentId === a.id) {
        setSelected(null);
        setForm(null);
        setActionMessage("");
      } else {
        setSelected({ type: "payment", receiptId, paymentId: a.id });
        setForm(paymentToForm(a));
        setActionMessage("");
      }
    },
    [selected],
  );

  const updateField = useCallback(
    (field: keyof PaymentFormState, value: string) => {
      setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
      setActionMessage("");
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Create new payment
  // -------------------------------------------------------------------------

  const handleRecordPayment = useCallback(async () => {
    if (!form || selected?.type !== "receipt") return;
    const receipt = receipts.find((r) => String(r.id) === selected.receiptId);
    if (!receipt) return;

    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      setActionMessage("Enter a payment amount.");
      setActionTone("error");
      return;
    }
    if (!form.payment_date) {
      setActionMessage("Payment date is required.");
      setActionTone("error");
      return;
    }
    const balanceDue = Number(receipt.balance_due);
    if (amount > balanceDue) {
      setActionMessage(`Amount exceeds balance due (${formatMoney(receipt.balance_due)}).`);
      setActionTone("error");
      return;
    }

    setSaving(true);
    setActionMessage("");

    try {
      const res = await fetch(`${apiBase}/payments/`, {
        method: "POST",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "outbound",
          method: form.method,
          status: "settled",
          amount: form.amount,
          payment_date: form.payment_date,
          reference_number: form.reference_number,
          notes: form.notes,
          project: receipt.project,
          target_type: "receipt",
          target_id: receipt.id,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setActionMessage(json.error?.message ?? "Failed to create payment.");
        setActionTone("error");
        return;
      }

      setActionMessage("Payment recorded.");
      setActionTone("success");
      await load();
      setSelected(null);
      setForm(null);
    } catch {
      setActionMessage("Network error — could not record payment.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [form, selected, receipts, apiBase, authToken, load]);

  // -------------------------------------------------------------------------
  // Edit / Void
  // -------------------------------------------------------------------------

  const handleUpdatePayment = useCallback(async () => {
    if (!form || selected?.type !== "payment") return;
    if (!form.payment_date) {
      setActionMessage("Payment date is required.");
      setActionTone("error");
      return;
    }

    setSaving(true);
    setActionMessage("");

    try {
      const res = await fetch(`${apiBase}/payments/${selected.paymentId}/`, {
        method: "PATCH",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_date: form.payment_date,
          reference_number: form.reference_number,
          notes: form.notes,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setActionMessage(json.error?.message ?? "Failed to update payment.");
        setActionTone("error");
        return;
      }

      setActionMessage("Payment updated.");
      setActionTone("success");
      await load();
      setSelected(null);
      setForm(null);
    } catch {
      setActionMessage("Network error — could not update payment.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [form, selected, apiBase, authToken, load]);

  const handleVoidPayment = useCallback(async () => {
    if (selected?.type !== "payment") return;
    setSaving(true);
    setActionMessage("");

    try {
      const res = await fetch(`${apiBase}/payments/${selected.paymentId}/`, {
        method: "PATCH",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ status: "void" }),
      });
      const json = await res.json();

      if (!res.ok) {
        setActionMessage(json.error?.message ?? "Failed to void payment.");
        setActionTone("error");
        return;
      }

      setActionMessage("Payment voided.");
      setActionTone("success");
      await load();
      setSelected(null);
      setForm(null);
    } catch {
      setActionMessage("Network error — could not void payment.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [selected, apiBase, authToken, load]);

  // -------------------------------------------------------------------------
  // Filtering + summary
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let result = receipts;
    if (filterUnpaid) {
      result = result.filter((r) => Number(r.balance_due) > 0);
    }
    const searchNeedle = search.trim().toLowerCase();
    if (searchNeedle) {
      result = result.filter(
        (r) =>
          r.store_name.toLowerCase().includes(searchNeedle) ||
          r.project_name.toLowerCase().includes(searchNeedle) ||
          r.amount.includes(searchNeedle) ||
          r.notes.toLowerCase().includes(searchNeedle),
      );
    }
    return result;
  }, [receipts, search, filterUnpaid]);

  const summary = useMemo(() => {
    const unpaid = receipts.filter((r) => Number(r.balance_due) > 0);
    const totalOutstanding = unpaid.reduce((sum, r) => sum + Number(r.balance_due), 0);
    return { unpaidCount: unpaid.length, totalOutstanding };
  }, [receipts]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  // -------------------------------------------------------------------------
  // Shared form render
  // -------------------------------------------------------------------------

  function renderForm(mode: "create" | "edit", r: ReceiptRecord) {
    if (!form) return null;
    const isCreate = mode === "create";
    const balanceDue = Number(r.balance_due);
    const canCreate = balanceDue > 0;

    if (isCreate && !canCreate) return null;

    return (
      <div className={styles.paymentExpandedSections} onClick={(e) => e.stopPropagation()}>
        <div className={styles.paymentSection}>
          <h4 className={styles.paymentSectionHeading}>
            {isCreate ? "Record Payment" : "Edit Payment"}
          </h4>
          <div className={styles.paymentSectionContent}>
            {isCreate ? (
              <div className={styles.paymentFieldGrid}>
                <label className={styles.paymentField}>
                  Amount
                  <input type="number" step="0.01" min="0.01" value={form.amount}
                    onChange={(e) => updateField("amount", e.target.value)} disabled={saving}
                    placeholder={`Up to ${formatMoney(r.balance_due)}`} />
                </label>
                <label className={styles.paymentField}>
                  Method
                  <select value={form.method} onChange={(e) => updateField("method", e.target.value)} disabled={saving}>
                    {METHOD_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.paymentField}>
                  Payment Date
                  <input type="date" value={form.payment_date}
                    onChange={(e) => updateField("payment_date", e.target.value)} disabled={saving} />
                </label>
                <label className={styles.paymentField}>
                  Reference #
                  <input type="text" value={form.reference_number}
                    onChange={(e) => updateField("reference_number", e.target.value)} disabled={saving}
                    placeholder="Check #, transaction ID, etc." />
                </label>
              </div>
            ) : (
              <div className={styles.paymentFieldGrid}>
                <div className={styles.paymentFieldReadOnly}>
                  <span>Amount</span>
                  <span className={styles.paymentFieldValue}>{formatMoney(form.amount)}</span>
                </div>
                <div className={styles.paymentFieldReadOnly}>
                  <span>Method</span>
                  <span className={styles.paymentFieldValue}>{METHOD_LABELS[form.method] ?? form.method}</span>
                </div>
                <label className={styles.paymentField}>
                  Payment Date
                  <input type="date" value={form.payment_date}
                    onChange={(e) => updateField("payment_date", e.target.value)} disabled={saving} />
                </label>
                <label className={styles.paymentField}>
                  Reference #
                  <input type="text" value={form.reference_number}
                    onChange={(e) => updateField("reference_number", e.target.value)} disabled={saving}
                    placeholder="Check #, transaction ID, etc." />
                </label>
              </div>
            )}
            <label className={styles.paymentFieldFull}>
              Notes
              <textarea value={form.notes} onChange={(e) => updateField("notes", e.target.value)}
                disabled={saving} placeholder="Optional notes about this payment." rows={2} />
            </label>

            {actionMessage ? (
              <p className={actionTone === "error" ? styles.paymentActionError : styles.paymentActionSuccess} role="status">
                {actionMessage}
              </p>
            ) : null}

            <div className={styles.paymentActionRow}>
              <button type="button" className={styles.paymentActionButtonPrimary}
                onClick={isCreate ? handleRecordPayment : handleUpdatePayment} disabled={saving}>
                {saving ? "Saving..." : isCreate ? "Record Payment" : "Save Changes"}
              </button>
              {!isCreate ? (
                <button type="button" className={styles.paymentActionButtonDanger}
                  onClick={handleVoidPayment} disabled={saving}>
                  Void Payment
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Payment card render
  // -------------------------------------------------------------------------

  function renderPaymentCard(a: ReceiptAllocationRecord, receiptId: string, isNested: boolean) {
    const isSelected = selected?.type === "payment" && (selected as { paymentId: number }).paymentId === a.id;
    const receipt = receipts.find((r) => String(r.id) === receiptId);
    const missingRef = !a.payment_reference && METHODS_EXPECTING_REFERENCE.has(a.payment_method);

    return (
      <article
        key={`pay-${a.id}`}
        className={`${isNested ? styles.paymentChildCard : styles.mobilePaymentCard} ${isSelected ? styles.paymentChildCardSelected : ""}`}
        onClick={(e) => { e.stopPropagation(); handleSelectPayment(receiptId, a); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSelectPayment(receiptId, a); }
        }}
        role="button" tabIndex={0} aria-pressed={isSelected}
      >
        <div className={styles.paymentChildTop}>
          <div className={styles.paymentChildIdentity}>
            <span className={styles.paymentChildMethod}>{METHOD_LABELS[a.payment_method] ?? a.payment_method}</span>
            <span className={styles.paymentChildMeta}>
              {formatDateDisplay(a.payment_date)}
              {a.payment_reference ? ` · Ref: ${a.payment_reference}` : ""}
            </span>
          </div>
          <div className={styles.paymentChildRight}>
            <span className={styles.paymentChildAmount}>{formatMoney(a.applied_amount)}</span>
            {a.payment_status !== "settled" ? (
              <span className={PAYMENT_STATUS_CLASS[a.payment_status] ?? ""}>{a.payment_status}</span>
            ) : null}
            {missingRef ? (
              <span className={styles.missingReference} title="No reference # recorded">No ref #</span>
            ) : null}
          </div>
        </div>
        {isSelected && receipt ? renderForm("edit", receipt as unknown as ReceiptRecord) : null}
      </article>
    );
  }

  // -------------------------------------------------------------------------
  // Desktop row render
  // -------------------------------------------------------------------------

  function renderDesktopGroup(r: ReceiptRecord) {
    const receiptId = String(r.id);
    const isRecSelected = selected?.type === "receipt" && selected.receiptId === receiptId;

    return (
      <div key={r.id}>
        <article
          className={`${styles.paymentRow} ${isRecSelected ? styles.paymentRowSelected : ""}`}
          onClick={() => handleSelectReceipt(r)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSelectReceipt(r); }
          }}
          role="button" tabIndex={0} aria-pressed={isRecSelected}
        >
          <div className={styles.documentIdentity}>
            <div className={styles.documentPrimary}>
              <span>{r.store_name || "Receipt"}</span>
            </div>
            <div className={styles.documentSecondary}>
              <span>{r.project_name}</span>
              <span>{formatDateDisplay(r.receipt_date)}</span>
              {r.notes ? <span>{r.notes.length > 40 ? `${r.notes.slice(0, 40)}...` : r.notes}</span> : null}
              {hasMissingReference(r.allocations) ? (
                <span className={styles.missingReference} title="Payment missing reference #">No ref #</span>
              ) : null}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={styles.documentAmount}>{formatMoney(r.amount)}</div>
            {Number(r.balance_due) > 0 && Number(r.balance_due) < Number(r.amount) ? (
              <div className={styles.documentBalance}>{formatMoney(r.balance_due)} due</div>
            ) : Number(r.balance_due) <= 0 && Number(r.amount) > 0 ? (
              <div className={styles.documentBalance}>Paid</div>
            ) : null}
          </div>
          {isRecSelected ? renderForm("create", r) : null}
        </article>
        {r.allocations.length > 0 ? r.allocations.map((a) => renderPaymentCard(a, receiptId, true)) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Mobile card render
  // -------------------------------------------------------------------------

  function renderMobileGroup(r: ReceiptRecord) {
    const receiptId = String(r.id);
    const isRecSelected = selected?.type === "receipt" && selected.receiptId === receiptId;
    const isPaid = Number(r.balance_due) <= 0 && Number(r.amount) > 0;
    const isPartial = Number(r.balance_due) > 0 && Number(r.balance_due) < Number(r.amount);

    return (
      <div key={r.id} className={styles.mobileBillGroup}>
        <article
          className={`${styles.mobileCard} ${isRecSelected ? styles.mobileCardSelected : ""}`}
          onClick={() => handleSelectReceipt(r)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSelectReceipt(r); }
          }}
          role="button" tabIndex={0} aria-pressed={isRecSelected}
        >
          <div className={styles.mobileCardTop}>
            <div className={styles.mobileCardIdentity}>
              <span className={styles.mobileCardVendor}>{r.store_name || "Receipt"}</span>
              <span className={styles.mobileCardProject}>{r.project_name}</span>
            </div>
            <div className={styles.mobileCardAmountBlock}>
              <span className={styles.mobileCardAmount}>{formatMoney(r.amount)}</span>
              {isPartial ? (
                <span className={styles.mobileCardBalanceDue}>{formatMoney(r.balance_due)} due</span>
              ) : isPaid ? (
                <span className={styles.mobileCardBalancePaid}>Paid</span>
              ) : null}
            </div>
          </div>
          <div className={styles.mobileCardMeta}>
            <span>{formatDateDisplay(r.receipt_date)}</span>
            {r.notes ? <span>{r.notes.length > 30 ? `${r.notes.slice(0, 30)}...` : r.notes}</span> : null}
          </div>
          {isRecSelected ? renderForm("create", r) : null}
        </article>
        {r.allocations.length > 0 ? r.allocations.map((a) => renderPaymentCard(a, receiptId, false)) : null}
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
      {isMobile ? (
        <div className={styles.summaryBanner}>
          <div className={styles.summaryBannerFilters}>
            <button type="button"
              className={`${styles.summaryBannerButton} ${filterUnpaid ? styles.summaryBannerButtonActive : ""}`}
              onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}>
              {summary.unpaidCount} unpaid
            </button>
          </div>
          <span className={styles.summaryBannerAmount}>
            {formatMoney(String(summary.totalOutstanding))} outstanding
          </span>
        </div>
      ) : null}

      <div className={styles.filterBar}>
        <input type="text" className={styles.searchInput} placeholder="Search receipts..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {!isMobile ? (
          <button type="button"
            className={`${styles.filterPill} ${filterUnpaid ? styles.filterPillActive : ""}`}
            onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}>
            Unpaid only
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No receipts found.</p>
      ) : (
        <>
          {isMobile ? (
            <div className={styles.mobileCardList}>
              {paginatedItems.map((r) => renderMobileGroup(r))}
            </div>
          ) : (
            <div className={styles.documentList}>
              {paginatedItems.map((r) => renderDesktopGroup(r))}
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
