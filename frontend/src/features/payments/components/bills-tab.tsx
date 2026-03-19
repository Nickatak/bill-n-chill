"use client";

/**
 * Bills tab — org-wide vendor bill browser for the accounting page.
 *
 * Bills render as cards with their payments as child cards below them.
 * Tap a bill to record a new payment. Tap a payment to edit it.
 *
 * Desktop: dense document list (grid rows) with payment rows nested.
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
    method: "check",
    payment_date: todayDateInput(),
    reference_number: "",
    notes: "",
  };
}

function paymentToForm(a: VendorBillAllocationRecord): PaymentFormState {
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
  | { type: "bill"; billId: string }
  | { type: "payment"; billId: string; paymentId: number };

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

  // Selection + form state
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [form, setForm] = useState<PaymentFormState | null>(null);
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
  // Selection handlers
  // -------------------------------------------------------------------------

  const handleSelectBill = useCallback(
    (b: VendorBillRecord) => {
      const billId = String(b.id);
      if (selected?.type === "bill" && selected.billId === billId) {
        setSelected(null);
        setForm(null);
        setActionMessage("");
      } else {
        setSelected({ type: "bill", billId });
        setForm(defaultNewPaymentForm(b.balance_due));
        setActionMessage("");
      }
    },
    [selected],
  );

  const handleSelectPayment = useCallback(
    (billId: string, a: VendorBillAllocationRecord) => {
      if (selected?.type === "payment" && (selected as { paymentId: number }).paymentId === a.id) {
        setSelected(null);
        setForm(null);
        setActionMessage("");
      } else {
        setSelected({ type: "payment", billId, paymentId: a.id });
        setForm(paymentToForm(a));
        setActionMessage("");
      }
    },
    [selected],
  );

  // -------------------------------------------------------------------------
  // Form field updates
  // -------------------------------------------------------------------------

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
    if (!form || selected?.type !== "bill") return;
    const bill = bills.find((b) => String(b.id) === selected.billId);
    if (!bill) return;

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

    const balanceDue = Number(bill.balance_due);
    if (amount > balanceDue) {
      setActionMessage(`Amount exceeds balance due (${formatMoney(bill.balance_due)}).`);
      setActionTone("error");
      return;
    }

    setSaving(true);
    setActionMessage("");

    try {
      const res = await fetch(`${apiBase}/payments/`, {
        method: "POST",
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "outbound",
          method: form.method,
          status: "settled",
          amount: form.amount,
          payment_date: form.payment_date,
          reference_number: form.reference_number,
          notes: form.notes,
          project: bill.project,
          target_type: "vendor_bill",
          target_id: bill.id,
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
  }, [form, selected, bills, apiBase, token, load]);

  // -------------------------------------------------------------------------
  // Edit existing payment
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
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
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
  }, [form, selected, apiBase, token, load]);

  // -------------------------------------------------------------------------
  // Void payment
  // -------------------------------------------------------------------------

  const handleVoidPayment = useCallback(async () => {
    if (selected?.type !== "payment") return;

    setSaving(true);
    setActionMessage("");

    try {
      const res = await fetch(`${apiBase}/payments/${selected.paymentId}/`, {
        method: "PATCH",
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
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
  }, [selected, apiBase, token, load]);

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
    const visible = hideVoided ? bills.filter((b) => b.status !== "void" && b.status !== "closed") : bills;
    const unpaid = visible.filter((b) => b.payment_status !== "paid");
    const totalOutstanding = unpaid.reduce((sum, b) => sum + Number(b.balance_due), 0);
    return { unpaidCount: unpaid.length, totalOutstanding };
  }, [bills, hideVoided]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  // -------------------------------------------------------------------------
  // Shared form render
  // -------------------------------------------------------------------------

  function renderForm(mode: "create" | "edit", bill: VendorBillRecord) {
    if (!form) return null;
    const isCreate = mode === "create";
    const balanceDue = Number(bill.balance_due);
    const canCreate = balanceDue > 0 && bill.status !== "void";

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
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.amount}
                    onChange={(e) => updateField("amount", e.target.value)}
                    disabled={saving}
                    placeholder={`Up to ${formatMoney(bill.balance_due)}`}
                  />
                </label>
                <label className={styles.paymentField}>
                  Method
                  <select
                    value={form.method}
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
                    value={form.payment_date}
                    onChange={(e) => updateField("payment_date", e.target.value)}
                    disabled={saving}
                  />
                </label>
                <label className={styles.paymentField}>
                  Reference #
                  <input
                    type="text"
                    value={form.reference_number}
                    onChange={(e) => updateField("reference_number", e.target.value)}
                    disabled={saving}
                    placeholder="Check #, transaction ID, etc."
                  />
                </label>
              </div>
            ) : (
              <>
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
                    <input
                      type="date"
                      value={form.payment_date}
                      onChange={(e) => updateField("payment_date", e.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <label className={styles.paymentField}>
                    Reference #
                    <input
                      type="text"
                      value={form.reference_number}
                      onChange={(e) => updateField("reference_number", e.target.value)}
                      disabled={saving}
                      placeholder="Check #, transaction ID, etc."
                    />
                  </label>
                </div>
              </>
            )}
            <label className={styles.paymentFieldFull}>
              Notes
              <textarea
                value={form.notes}
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
                onClick={isCreate ? handleRecordPayment : handleUpdatePayment}
                disabled={saving}
              >
                {saving ? "Saving..." : isCreate ? "Record Payment" : "Save Changes"}
              </button>
              {!isCreate ? (
                <button
                  type="button"
                  className={styles.paymentActionButtonDanger}
                  onClick={handleVoidPayment}
                  disabled={saving}
                >
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
  // Payment card render (shared between desktop and mobile)
  // -------------------------------------------------------------------------

  function renderPaymentCard(a: VendorBillAllocationRecord, billId: string, isNested: boolean) {
    const isSelected = selected?.type === "payment" && (selected as { paymentId: number }).paymentId === a.id;
    const bill = bills.find((b) => String(b.id) === billId);
    const missingRef = !a.payment_reference && METHODS_EXPECTING_REFERENCE.has(a.payment_method);

    return (
      <article
        key={`pay-${a.id}`}
        className={`${isNested ? styles.paymentChildCard : styles.mobilePaymentCard} ${isSelected ? styles.paymentChildCardSelected : ""}`}
        onClick={(e) => { e.stopPropagation(); handleSelectPayment(billId, a); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleSelectPayment(billId, a);
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
      >
        <div className={styles.paymentChildTop}>
          <div className={styles.paymentChildIdentity}>
            <span className={styles.paymentChildMethod}>
              {METHOD_LABELS[a.payment_method] ?? a.payment_method}
            </span>
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

        {isSelected && bill ? renderForm("edit", bill) : null}
      </article>
    );
  }

  // -------------------------------------------------------------------------
  // Desktop row render
  // -------------------------------------------------------------------------

  function renderDesktopBillGroup(b: VendorBillRecord) {
    const billId = String(b.id);
    const isBillSelected = selected?.type === "bill" && selected.billId === billId;

    return (
      <div key={b.id}>
        <article
          className={`${styles.paymentRow} ${isBillSelected ? styles.paymentRowSelected : ""}`}
          onClick={() => handleSelectBill(b)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSelectBill(b);
            }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={isBillSelected}
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

          {isBillSelected ? renderForm("create", b) : null}
        </article>

        {b.allocations.length > 0 ? (
          b.allocations.map((a) => renderPaymentCard(a, billId, true))
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Mobile card render
  // -------------------------------------------------------------------------

  function renderMobileBillGroup(b: VendorBillRecord) {
    const billId = String(b.id);
    const isBillSelected = selected?.type === "bill" && selected.billId === billId;
    const isPaid = Number(b.balance_due) <= 0 && Number(b.total) > 0;
    const isPartial = Number(b.balance_due) > 0 && Number(b.balance_due) < Number(b.total);

    return (
      <div key={b.id} className={styles.mobileBillGroup}>
        <article
          className={`${styles.mobileCard} ${isBillSelected ? styles.mobileCardSelected : ""}`}
          onClick={() => handleSelectBill(b)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSelectBill(b);
            }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={isBillSelected}
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
          </div>

          {isBillSelected ? renderForm("create", b) : null}
        </article>

        {b.allocations.length > 0 ? (
          b.allocations.map((a) => renderPaymentCard(a, billId, false))
        ) : null}
      </div>
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
      {/* Mobile: summary banner with inline filter toggles */}
      {isMobile ? (
        <div className={styles.summaryBanner}>
          <div className={styles.summaryBannerFilters}>
            <button
              type="button"
              className={`${styles.summaryBannerButton} ${filterUnpaid ? styles.summaryBannerButtonActive : ""}`}
              onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}
            >
              {summary.unpaidCount} unpaid
            </button>
            <button
              type="button"
              className={`${styles.summaryBannerButton} ${hideVoided ? styles.summaryBannerButtonActive : ""}`}
              onClick={() => { setHideVoided((v) => !v); setPage(1); }}
            >
              Hide closed
            </button>
          </div>
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
          <>
            <button
              type="button"
              className={`${styles.filterPill} ${filterUnpaid ? styles.filterPillActive : ""}`}
              onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}
            >
              Unpaid only
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${hideVoided ? styles.filterPillActive : ""}`}
              onClick={() => { setHideVoided((v) => !v); setPage(1); }}
            >
              Hide closed
            </button>
          </>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No vendor bills found.</p>
      ) : (
        <>
          {isMobile ? (
            <div className={styles.mobileCardList}>
              {paginatedItems.map((b) => renderMobileBillGroup(b))}
            </div>
          ) : (
            <div className={styles.documentList}>
              {paginatedItems.map((b) => renderDesktopBillGroup(b))}
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
