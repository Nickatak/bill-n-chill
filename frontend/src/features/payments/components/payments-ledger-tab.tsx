"use client";

/**
 * Payments ledger tab — org-wide view of all payments (inbound + outbound).
 *
 * Shows a compact list of all payments with direction, status, and target info.
 * Filterable by direction and status. Rows expand inline for editing.
 *
 * Edit policy:
 * - Freely editable: amount, method, date, reference_number, notes, project
 * - Read-only (void + re-enter to change): customer, direction
 * - Every save creates an immutable PaymentRecord snapshot
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";
import { formatDateDisplay } from "@/shared/date-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import type { PaymentRecord } from "../types";
import styles from "./accounting-console.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const METHOD_OPTIONS = Object.entries(METHOD_LABELS);

const ALLOCATION_TARGET_LABELS: Record<string, string> = {
  invoice: "Invoice",
  vendor_bill: "Vendor Bill",
};

function formatMoney(val: string): string {
  const parsed = Number(val);
  if (Number.isNaN(parsed)) return val;
  return `$${parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Edit form state
// ---------------------------------------------------------------------------

type EditFormState = {
  amount: string;
  method: string;
  payment_date: string;
  reference_number: string;
  notes: string;
  status: string;
};

function paymentToEditForm(p: PaymentRecord): EditFormState {
  return {
    amount: p.amount,
    method: p.method,
    payment_date: p.payment_date,
    reference_number: p.reference_number,
    notes: p.notes,
    status: p.status,
  };
}

function editFormHasChanges(form: EditFormState, original: PaymentRecord): boolean {
  return (
    form.amount !== original.amount ||
    form.method !== original.method ||
    form.payment_date !== original.payment_date ||
    form.reference_number !== original.reference_number ||
    form.notes !== original.notes ||
    form.status !== original.status
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaymentsLedgerTab({
  authToken,
  baseUrl,
}: {
  authToken: string;
  baseUrl: string;
}) {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  // Inline expand state
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>("");
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"success" | "error">("success");

  const apiBase = normalizeApiBaseUrl(baseUrl);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/payments/`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.ok) {
        const json = await res.json();
        setPayments(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, authToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Find the full record for the selected payment
  const selectedPayment = useMemo(
    () => payments.find((p) => String(p.id) === selectedPaymentId) ?? null,
    [payments, selectedPaymentId],
  );

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const handleSelectPayment = useCallback(
    (p: PaymentRecord) => {
      const id = String(p.id);
      if (selectedPaymentId === id) {
        // Deselect
        setSelectedPaymentId("");
        setEditForm(null);
        setActionMessage("");
      } else {
        setSelectedPaymentId(id);
        setEditForm(paymentToEditForm(p));
        setActionMessage("");
      }
    },
    [selectedPaymentId],
  );

  // -------------------------------------------------------------------------
  // Edit form handlers
  // -------------------------------------------------------------------------

  const updateField = useCallback(
    (field: keyof EditFormState, value: string) => {
      setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
      setActionMessage("");
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!editForm || !selectedPayment) return;
    if (!editFormHasChanges(editForm, selectedPayment)) {
      setActionMessage("No changes to save.");
      setActionTone("error");
      return;
    }

    setSaving(true);
    setActionMessage("");
    try {
      // Build a diff payload — only send changed fields
      const payload: Record<string, string> = {};
      if (editForm.amount !== selectedPayment.amount) payload.amount = editForm.amount;
      if (editForm.method !== selectedPayment.method) payload.method = editForm.method;
      if (editForm.payment_date !== selectedPayment.payment_date) payload.payment_date = editForm.payment_date;
      if (editForm.reference_number !== selectedPayment.reference_number) payload.reference_number = editForm.reference_number;
      if (editForm.notes !== selectedPayment.notes) payload.notes = editForm.notes;
      if (editForm.status !== selectedPayment.status) payload.status = editForm.status;

      const res = await fetch(`${apiBase}/payments/${selectedPayment.id}/`, {
        method: "PATCH",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (res.ok) {
        // Update the payment in the local list
        const updated = json.data as PaymentRecord;
        setPayments((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setEditForm(paymentToEditForm(updated));
        setActionMessage("Payment updated.");
        setActionTone("success");
      } else {
        const errMsg = json.error?.message ?? "Failed to save payment.";
        setActionMessage(errMsg);
        setActionTone("error");
      }
    } catch {
      setActionMessage("Network error — could not save.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [editForm, selectedPayment, apiBase, authToken]);

  const handleCancel = useCallback(() => {
    if (selectedPayment) {
      setEditForm(paymentToEditForm(selectedPayment));
    }
    setActionMessage("");
  }, [selectedPayment]);

  const handleVoid = useCallback(async () => {
    if (!selectedPayment) return;
    if (selectedPayment.status === "void") return;

    setSaving(true);
    setActionMessage("");
    try {
      const res = await fetch(`${apiBase}/payments/${selectedPayment.id}/`, {
        method: "PATCH",
        headers: { ...buildAuthHeaders(authToken), "Content-Type": "application/json" },
        body: JSON.stringify({ status: "void" }),
      });
      const json = await res.json();

      if (res.ok) {
        const updated = json.data as PaymentRecord;
        setPayments((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setEditForm(paymentToEditForm(updated));
        setActionMessage("Payment voided.");
        setActionTone("success");
      } else {
        const errMsg = json.error?.message ?? "Failed to void payment.";
        setActionMessage(errMsg);
        setActionTone("error");
      }
    } catch {
      setActionMessage("Network error — could not void.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [selectedPayment, apiBase, authToken]);

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let result = payments;
    if (directionFilter !== "all") {
      result = result.filter((p) => p.direction === directionFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    if (search.trim()) {
      const searchNeedle = search.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.customer_name.toLowerCase().includes(searchNeedle) ||
          p.project_name.toLowerCase().includes(searchNeedle) ||
          p.reference_number.toLowerCase().includes(searchNeedle) ||
          p.amount.includes(searchNeedle) ||
          (METHOD_LABELS[p.method] ?? p.method).toLowerCase().includes(searchNeedle),
      );
    }
    return result;
  }, [payments, directionFilter, statusFilter, search]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  function renderExpandedPayment(p: PaymentRecord) {
    if (!editForm) return null;
    const isVoid = p.status === "void";
    const hasChanges = editFormHasChanges(editForm, p);

    return (
      <div className={styles.paymentExpandedSections} onClick={(e) => e.stopPropagation()}>
        {/* Edit fields */}
        <div className={styles.paymentSection}>
          <h4 className={styles.paymentSectionHeading}>Payment Details</h4>
          <div className={styles.paymentSectionContent}>
            {/* Read-only fields: customer and direction */}
            <div className={styles.paymentFieldGrid}>
              <div className={styles.paymentFieldReadOnly}>
                <span>Customer</span>
                <span className={styles.paymentFieldValue}>
                  {p.customer_name || "—"}
                </span>
              </div>
              <div className={styles.paymentFieldReadOnly}>
                <span>Direction</span>
                <span className={styles.paymentFieldValue}>
                  {p.direction}
                </span>
              </div>
            </div>

            {/* Editable fields */}
            <div className={styles.paymentFieldGrid}>
              <label className={styles.paymentField}>
                Amount
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editForm.amount}
                  onChange={(e) => updateField("amount", e.target.value)}
                  disabled={isVoid || saving}
                />
              </label>
              <label className={styles.paymentField}>
                Method
                <select
                  value={editForm.method}
                  onChange={(e) => updateField("method", e.target.value)}
                  disabled={isVoid || saving}
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
                  value={editForm.payment_date}
                  onChange={(e) => updateField("payment_date", e.target.value)}
                  disabled={isVoid || saving}
                />
              </label>
              <label className={styles.paymentField}>
                Reference #
                <input
                  type="text"
                  value={editForm.reference_number}
                  onChange={(e) => updateField("reference_number", e.target.value)}
                  disabled={isVoid || saving}
                  placeholder="Check #, transaction ID, etc."
                />
              </label>
            </div>
            <label className={styles.paymentFieldFull}>
              Notes
              <textarea
                value={editForm.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                disabled={isVoid || saving}
                placeholder="Optional notes about this payment."
                rows={2}
              />
            </label>

            {/* Action messages */}
            {actionMessage ? (
              <p
                className={actionTone === "error" ? styles.paymentActionError : styles.paymentActionSuccess}
                role="status"
              >
                {actionMessage}
              </p>
            ) : null}

            {/* Action buttons */}
            <div className={styles.paymentActionRow}>
              {!isVoid ? (
                <>
                  <button
                    type="button"
                    className={styles.paymentActionButtonPrimary}
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className={styles.paymentActionButtonSecondary}
                    onClick={handleCancel}
                    disabled={saving || !hasChanges}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.paymentActionButtonDanger}
                    onClick={handleVoid}
                    disabled={saving}
                  >
                    Void Payment
                  </button>
                </>
              ) : (
                <p className={styles.allocationMeta}>This payment has been voided and cannot be edited.</p>
              )}
            </div>
          </div>
        </div>

        {/* Target document */}
        {p.target_type ? (
          <div className={styles.paymentSection}>
            <h4 className={styles.paymentSectionHeading}>Target Document</h4>
            <div className={styles.paymentSectionContent}>
              <p className={styles.allocationMeta}>
                {ALLOCATION_TARGET_LABELS[p.target_type] ?? p.target_type} #{p.target_id}
              </p>
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
            {paginatedItems.map((p) => {
              const isSelected = String(p.id) === selectedPaymentId;
              return (
                <article
                  key={p.id}
                  className={`${styles.paymentRow} ${isSelected ? styles.paymentRowSelected : ""}`}
                  onClick={() => handleSelectPayment(p)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectPayment(p);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                >
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
                  </div>

                  {isSelected && selectedPayment ? renderExpandedPayment(selectedPayment) : null}
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
