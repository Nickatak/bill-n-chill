"use client";

/**
 * Invoices tab — org-wide invoice browser for the accounting page.
 *
 * Shows all invoices across projects. Rows expand inline to show
 * attached payments and a form to record a new inbound payment against
 * the invoice. Creating a payment auto-allocates it to the invoice.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl } from "@/shared/api/base";
import { formatDateDisplay, todayDateInput } from "@/shared/date-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

import styles from "./accounting-console.module.css";

// ---------------------------------------------------------------------------
// Types (lightweight — only what the tab needs from the org-level endpoint)
// ---------------------------------------------------------------------------

type InvoiceAllocationRecord = {
  id: number;
  payment: number;
  applied_amount: string;
  payment_date: string;
  payment_method: string;
  payment_status: string;
  payment_reference: string;
  created_at: string;
};

type InvoiceListRecord = {
  id: number;
  project: number;
  project_name: string;
  customer: number;
  customer_display_name: string;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  total: string;
  balance_due: string;
  allocations: InvoiceAllocationRecord[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVOICE_STATUS_CLASS: Record<string, string> = {
  draft: styles.statusReceived,
  sent: styles.statusApproved,
  partially_paid: styles.statusPending,
  paid: styles.statusSettled,
  void: styles.statusVoid,
  disputed: styles.statusDisputed,
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

export function InvoicesTab({
  token,
  baseUrl,
}: {
  token: string;
  baseUrl: string;
}) {
  const [invoices, setInvoices] = useState<InvoiceListRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Expand state
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [paymentForm, setPaymentForm] = useState<NewPaymentForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"success" | "error">("success");

  const apiBase = normalizeApiBaseUrl(baseUrl);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/invoices/`, {
        headers: buildAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        setInvoices(json.data ?? []);
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

  const handleSelectInvoice = useCallback(
    (inv: InvoiceListRecord) => {
      const id = String(inv.id);
      if (selectedInvoiceId === id) {
        setSelectedInvoiceId("");
        setPaymentForm(null);
        setActionMessage("");
      } else {
        setSelectedInvoiceId(id);
        setPaymentForm(defaultPaymentForm(inv.balance_due));
        setActionMessage("");
      }
    },
    [selectedInvoiceId],
  );

  const selectedInvoice = useMemo(
    () => invoices.find((inv) => String(inv.id) === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
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
    if (!paymentForm || !selectedInvoice) return;

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

    const balanceDue = Number(selectedInvoice.balance_due);
    if (amount > balanceDue) {
      setActionMessage(`Amount exceeds balance due (${formatMoney(selectedInvoice.balance_due)}).`);
      setActionTone("error");
      return;
    }

    setSaving(true);
    setActionMessage("");

    try {
      // Step 1: Create the inbound payment
      const createRes = await fetch(`${apiBase}/payments/`, {
        method: "POST",
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "inbound",
          method: paymentForm.method,
          status: "settled",
          amount: paymentForm.amount,
          payment_date: paymentForm.payment_date,
          reference_number: paymentForm.reference_number,
          notes: paymentForm.notes,
          project: selectedInvoice.project,
        }),
      });
      const createJson = await createRes.json();

      if (!createRes.ok) {
        setActionMessage(createJson.error?.message ?? "Failed to create payment.");
        setActionTone("error");
        return;
      }

      const paymentId = createJson.data?.id;

      // Step 2: Allocate to this invoice
      const allocateRes = await fetch(`${apiBase}/payments/${paymentId}/allocate/`, {
        method: "POST",
        headers: { ...buildAuthHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: [
            {
              target_type: "invoice",
              target_id: selectedInvoice.id,
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

      // Success — reload invoices to get updated balances and allocations
      setActionMessage("Payment recorded and applied.");
      setActionTone("success");
      await load();

      // Re-select the invoice and reset the form with updated balance
      const refreshedInvoice = invoices.find((inv) => inv.id === selectedInvoice.id);
      if (refreshedInvoice) {
        setPaymentForm(defaultPaymentForm(refreshedInvoice.balance_due));
      }
    } catch {
      setActionMessage("Network error — could not record payment.");
      setActionTone("error");
    } finally {
      setSaving(false);
    }
  }, [paymentForm, selectedInvoice, apiBase, token, load, invoices]);

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.trim().toLowerCase();
    return invoices.filter(
      (inv) =>
        inv.customer_display_name.toLowerCase().includes(q) ||
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.project_name.toLowerCase().includes(q) ||
        inv.total.includes(q),
    );
  }, [invoices, search]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  function renderAllocations(allocations: InvoiceAllocationRecord[]) {
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

  function renderExpanded(inv: InvoiceListRecord) {
    if (!paymentForm) return null;
    const balanceDue = Number(inv.balance_due);
    const canRecordPayment = balanceDue > 0 && inv.status !== "void";

    return (
      <div className={styles.paymentExpandedSections} onClick={(e) => e.stopPropagation()}>
        {/* Existing payments */}
        <div className={styles.paymentSection}>
          <h4 className={styles.paymentSectionHeading}>
            Payments ({inv.allocations.length})
          </h4>
          <div className={styles.paymentSectionContent}>
            {renderAllocations(inv.allocations)}
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
                    max={inv.balance_due}
                    value={paymentForm.amount}
                    onChange={(e) => updateField("amount", e.target.value)}
                    disabled={saving}
                    placeholder={`Up to ${formatMoney(inv.balance_due)}`}
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
    return <p className={styles.loadingText}>Loading invoices...</p>;
  }

  return (
    <div>
      <div className={styles.filterBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No invoices found.</p>
      ) : (
        <>
          <div className={styles.documentList}>
            {paginatedItems.map((inv) => {
              const isSelected = String(inv.id) === selectedInvoiceId;
              return (
                <article
                  key={inv.id}
                  className={`${styles.paymentRow} ${isSelected ? styles.paymentRowSelected : ""}`}
                  onClick={() => handleSelectInvoice(inv)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectInvoice(inv);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                >
                  <div className={styles.documentIdentity}>
                    <div className={styles.documentPrimary}>
                      <span className={INVOICE_STATUS_CLASS[inv.status] ?? ""}>{inv.status}</span>
                      <span>{inv.customer_display_name}</span>
                      <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>#{inv.invoice_number}</span>
                    </div>
                    <div className={styles.documentSecondary}>
                      <span>{inv.project_name}</span>
                      {inv.due_date ? <span>Due {formatDateDisplay(inv.due_date)}</span> : null}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className={styles.documentAmount}>{formatMoney(inv.total)}</div>
                    {Number(inv.balance_due) > 0 && Number(inv.balance_due) < Number(inv.total) ? (
                      <div className={styles.documentBalance}>
                        {formatMoney(inv.balance_due)} due
                      </div>
                    ) : Number(inv.balance_due) <= 0 && Number(inv.total) > 0 ? (
                      <div className={styles.documentBalance}>Paid</div>
                    ) : null}
                  </div>

                  {isSelected && selectedInvoice ? renderExpanded(selectedInvoice) : null}
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
