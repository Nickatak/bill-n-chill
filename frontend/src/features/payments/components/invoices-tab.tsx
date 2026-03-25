"use client";

/**
 * Invoices tab — org-wide invoice browser for the accounting page.
 *
 * Invoices render as cards with their payments as child cards below them.
 * Tap an invoice to record a new inbound payment. Tap a payment to edit it.
 *
 * Desktop: dense document list (grid rows) with payment rows nested.
 * Mobile:  card list with summary banner, collapsible search.
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

type InvoiceAllocationRecord = {
  id: number;
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
  draft: styles.statusDraft,
  sent: styles.statusSent,
  outstanding: styles.statusOutstanding,
  closed: styles.statusClosed,
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

const METHODS_EXPECTING_REFERENCE = new Set(["check", "ach", "wire", "card"]);

function hasMissingReference(allocations: InvoiceAllocationRecord[]): boolean {
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
    method: "check",
    payment_date: todayDateInput(),
    reference_number: "",
    notes: "",
  };
}

function paymentToForm(a: InvoiceAllocationRecord): PaymentFormState {
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
  | { type: "invoice"; invoiceId: string }
  | { type: "payment"; invoiceId: string; paymentId: number };

export function InvoicesTab({
  authToken,
  baseUrl,
  isMobile,
}: {
  authToken: string;
  baseUrl: string;
  isMobile: boolean;
}) {
  const [invoices, setInvoices] = useState<InvoiceListRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hideVoided, setHideVoided] = useState(true);
  const [filterUnpaid, setFilterUnpaid] = useState(true);

  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [form, setForm] = useState<PaymentFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"success" | "error">("success");

  const apiBase = normalizeApiBaseUrl(baseUrl);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/invoices/`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.ok) {
        const json = await res.json();
        setInvoices(json.data ?? []);
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

  const handleSelectInvoice = useCallback(
    (inv: InvoiceListRecord) => {
      const invoiceId = String(inv.id);
      if (selected?.type === "invoice" && selected.invoiceId === invoiceId) {
        setSelected(null);
        setForm(null);
        setActionMessage("");
      } else {
        setSelected({ type: "invoice", invoiceId });
        setForm(defaultNewPaymentForm(inv.balance_due));
        setActionMessage("");
      }
    },
    [selected],
  );

  const handleSelectPayment = useCallback(
    (invoiceId: string, a: InvoiceAllocationRecord) => {
      if (selected?.type === "payment" && (selected as { paymentId: number }).paymentId === a.id) {
        setSelected(null);
        setForm(null);
        setActionMessage("");
      } else {
        setSelected({ type: "payment", invoiceId, paymentId: a.id });
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
    if (!form || selected?.type !== "invoice") return;
    const inv = invoices.find((i) => String(i.id) === selected.invoiceId);
    if (!inv) return;

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
    const balanceDue = Number(inv.balance_due);
    if (amount > balanceDue) {
      setActionMessage(`Amount exceeds balance due (${formatMoney(inv.balance_due)}).`);
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
          direction: "inbound",
          method: form.method,
          status: "settled",
          amount: form.amount,
          payment_date: form.payment_date,
          reference_number: form.reference_number,
          notes: form.notes,
          customer: inv.customer,
          project: inv.project,
          target_type: "invoice",
          target_id: inv.id,
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
  }, [form, selected, invoices, apiBase, authToken, load]);

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
    // Drafts can't accept payments — exclude unconditionally
    let result = invoices.filter((inv) => inv.status !== "draft");
    if (hideVoided) {
      result = result.filter((inv) => inv.status !== "void");
    }
    if (filterUnpaid) {
      result = result.filter((inv) => inv.status !== "closed");
    }
    const searchNeedle = search.trim().toLowerCase();
    if (searchNeedle) {
      result = result.filter(
        (inv) =>
          inv.customer_display_name.toLowerCase().includes(searchNeedle) ||
          inv.invoice_number.toLowerCase().includes(searchNeedle) ||
          inv.project_name.toLowerCase().includes(searchNeedle) ||
          inv.total.includes(searchNeedle),
      );
    }
    return result;
  }, [invoices, search, hideVoided, filterUnpaid]);

  const summary = useMemo(() => {
    const noDrafts = invoices.filter((inv) => inv.status !== "draft");
    const visible = hideVoided ? noDrafts.filter((inv) => inv.status !== "void") : noDrafts;
    const unpaid = visible.filter((inv) => inv.status !== "closed");
    const totalOutstanding = unpaid.reduce((sum, inv) => sum + Number(inv.balance_due), 0);
    return { unpaidCount: unpaid.length, totalOutstanding };
  }, [invoices, hideVoided]);

  const { page, paginatedItems, totalPages, totalCount, setPage } = useClientPagination(filtered, 25);

  // -------------------------------------------------------------------------
  // Shared form render
  // -------------------------------------------------------------------------

  function renderForm(mode: "create" | "edit", inv: InvoiceListRecord) {
    if (!form) return null;
    const isCreate = mode === "create";
    const balanceDue = Number(inv.balance_due);
    const canCreate = balanceDue > 0 && inv.status !== "void";

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
                    placeholder={`Up to ${formatMoney(inv.balance_due)}`} />
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

  function renderPaymentCard(a: InvoiceAllocationRecord, invoiceId: string, isNested: boolean) {
    const isSelected = selected?.type === "payment" && (selected as { paymentId: number }).paymentId === a.id;
    const inv = invoices.find((i) => String(i.id) === invoiceId);
    const missingRef = !a.payment_reference && METHODS_EXPECTING_REFERENCE.has(a.payment_method);

    return (
      <article
        key={`pay-${a.id}`}
        className={`${isNested ? styles.paymentChildCard : styles.mobilePaymentCard} ${isSelected ? styles.paymentChildCardSelected : ""}`}
        onClick={(e) => { e.stopPropagation(); handleSelectPayment(invoiceId, a); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSelectPayment(invoiceId, a); }
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
        {isSelected && inv ? renderForm("edit", inv) : null}
      </article>
    );
  }

  // -------------------------------------------------------------------------
  // Desktop row render
  // -------------------------------------------------------------------------

  function renderDesktopGroup(inv: InvoiceListRecord) {
    const invoiceId = String(inv.id);
    const isInvSelected = selected?.type === "invoice" && selected.invoiceId === invoiceId;

    return (
      <div key={inv.id}>
        <article
          className={`${styles.paymentRow} ${isInvSelected ? styles.paymentRowSelected : ""}`}
          onClick={() => handleSelectInvoice(inv)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSelectInvoice(inv); }
          }}
          role="button" tabIndex={0} aria-pressed={isInvSelected}
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
              {hasMissingReference(inv.allocations) ? (
                <span className={styles.missingReference} title="Payment missing reference #">No ref #</span>
              ) : null}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={styles.documentAmount}>{formatMoney(inv.total)}</div>
            {Number(inv.balance_due) > 0 && Number(inv.balance_due) < Number(inv.total) ? (
              <div className={styles.documentBalance}>{formatMoney(inv.balance_due)} due</div>
            ) : Number(inv.balance_due) <= 0 && Number(inv.total) > 0 ? (
              <div className={styles.documentBalance}>Paid</div>
            ) : null}
          </div>
          {isInvSelected ? renderForm("create", inv) : null}
        </article>
        {inv.allocations.length > 0 ? inv.allocations.map((a) => renderPaymentCard(a, invoiceId, true)) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Mobile card render
  // -------------------------------------------------------------------------

  function renderMobileGroup(inv: InvoiceListRecord) {
    const invoiceId = String(inv.id);
    const isInvSelected = selected?.type === "invoice" && selected.invoiceId === invoiceId;
    const isPaid = Number(inv.balance_due) <= 0 && Number(inv.total) > 0;
    const isPartial = Number(inv.balance_due) > 0 && Number(inv.balance_due) < Number(inv.total);

    return (
      <div key={inv.id} className={styles.mobileBillGroup}>
        <article
          className={`${styles.mobileCard} ${isInvSelected ? styles.mobileCardSelected : ""}`}
          onClick={() => handleSelectInvoice(inv)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleSelectInvoice(inv); }
          }}
          role="button" tabIndex={0} aria-pressed={isInvSelected}
        >
          <div className={styles.mobileCardTop}>
            <div className={styles.mobileCardIdentity}>
              <span className={styles.mobileCardVendor}>{inv.customer_display_name}</span>
              <span className={styles.mobileCardProject}>{inv.project_name}</span>
            </div>
            <div className={styles.mobileCardAmountBlock}>
              <span className={styles.mobileCardAmount}>{formatMoney(inv.total)}</span>
              {isPartial ? (
                <span className={styles.mobileCardBalanceDue}>{formatMoney(inv.balance_due)} due</span>
              ) : isPaid ? (
                <span className={styles.mobileCardBalancePaid}>Paid</span>
              ) : null}
            </div>
          </div>
          <div className={styles.mobileCardMeta}>
            <span className={INVOICE_STATUS_CLASS[inv.status] ?? ""}>{inv.status}</span>
            <span>#{inv.invoice_number}</span>
            {inv.due_date ? <span>Due {formatDateDisplay(inv.due_date)}</span> : null}
          </div>
          {isInvSelected ? renderForm("create", inv) : null}
        </article>
        {inv.allocations.length > 0 ? inv.allocations.map((a) => renderPaymentCard(a, invoiceId, false)) : null}
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
      {isMobile ? (
        <div className={styles.summaryBanner}>
          <div className={styles.summaryBannerFilters}>
            <button type="button"
              className={`${styles.summaryBannerButton} ${filterUnpaid ? styles.summaryBannerButtonActive : ""}`}
              onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}>
              {summary.unpaidCount} unpaid
            </button>
            <button type="button"
              className={`${styles.summaryBannerButton} ${hideVoided ? styles.summaryBannerButtonActive : ""}`}
              onClick={() => { setHideVoided((v) => !v); setPage(1); }}>
              Hide voided
            </button>
          </div>
          <span className={styles.summaryBannerAmount}>
            {formatMoney(String(summary.totalOutstanding))} outstanding
          </span>
        </div>
      ) : null}

      <div className={styles.filterBar}>
        <input type="text" className={styles.searchInput} placeholder="Search invoices..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {!isMobile ? (
          <>
            <button type="button"
              className={`${styles.filterPill} ${filterUnpaid ? styles.filterPillActive : ""}`}
              onClick={() => { setFilterUnpaid((v) => !v); setPage(1); }}>
              Unpaid only
            </button>
            <button type="button"
              className={`${styles.filterPill} ${hideVoided ? styles.filterPillActive : ""}`}
              onClick={() => { setHideVoided((v) => !v); setPage(1); }}>
              Hide voided
            </button>
          </>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className={styles.emptyState}>No invoices found.</p>
      ) : (
        <>
          {isMobile ? (
            <div className={styles.mobileCardList}>
              {paginatedItems.map((inv) => renderMobileGroup(inv))}
            </div>
          ) : (
            <div className={styles.documentList}>
              {paginatedItems.map((inv) => renderDesktopGroup(inv))}
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
