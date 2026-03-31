/**
 * Presentational component for the invoices viewer panel.
 *
 * Renders the invoice list with status filters, search, pagination,
 * and expanded invoice detail (status & actions, status history,
 * line items, contract breakdown). All data and handlers are received
 * via props — no hooks or side effects live here.
 *
 * Parent: InvoicesConsole
 */

import { useState } from "react";
import Link from "next/link";
import { formatDateDisplay, formatDateTimeDisplay } from "@/shared/date-format";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import { PaginationControls } from "@/shared/components/pagination-controls";
import { StatusEvents, type StatusEvent } from "@/shared/status-events/status-events";
import statusBadges from "@/shared/styles/status.module.css";
import {
  invoiceNextActionHint,
  invoiceStatusEventActionLabel,
} from "../helpers";
import { ReadOnlyLineTable, readOnlyLineTableStyles as roTableStyles } from "@/shared/document-viewer/read-only-line-table";
import type {
  CostCode,
  InvoiceLineInput,
  InvoiceRecord,
  InvoiceStatusEventRecord,
  ProjectRecord,
} from "../types";
import styles from "./invoices-console.module.css";

// ---------------------------------------------------------------------------
// Pure display helpers (CSS-dependent — kept local)
// ---------------------------------------------------------------------------

/** Map an invoice status to its CSS module class for badge coloring. */
function invoiceStatusClass(status: string): string {
  if (status === "draft") return styles.statusDraft;
  if (status === "sent") return styles.statusSent;
  if (status === "outstanding") return styles.statusOutstanding;
  if (status === "closed") return styles.statusClosed;
  if (status === "void") return styles.statusVoid;
  return "";
}

/** Map an invoice status to its tone class for inline status accents. */
function invoiceStatusToneClass(status: string): string {
  if (status === "draft") return styles.statusToneDraft;
  if (status === "sent") return styles.statusToneSent;
  if (status === "outstanding") return styles.statusToneOutstanding;
  if (status === "closed") return styles.statusToneClosed;
  if (status === "void") return styles.statusToneVoid;
  return "";
}

/** Map an invoice status to its card-level CSS class for list card border/accent. */
function invoiceCardStatusClass(status: string): string {
  if (status === "draft") return styles.invoiceCardStatusDraft;
  if (status === "sent") return styles.invoiceCardStatusSent;
  if (status === "outstanding") return styles.invoiceCardStatusOutstanding;
  if (status === "closed") return styles.invoiceCardStatusClosed;
  if (status === "void") return styles.invoiceCardStatusVoid;
  return "";
}

/** Map a status event to its shared badge class. */
const invoiceEventBadgeClasses: Record<string, string> = {
  draft: statusBadges.draft ?? "",
  sent: statusBadges.sent ?? "",
  outstanding: statusBadges.outstanding ?? "",
  closed: statusBadges.closed ?? "",
  void: statusBadges.void ?? "",
};

function invoiceEventBadgeClass(event: InvoiceStatusEventRecord): string {
  if (event.action_type === "notate") return statusBadges.neutral ?? "";
  if (event.action_type === "resend") return statusBadges.sent ?? "";
  if (event.action_type === "create") return statusBadges.draft ?? "";
  if (event.from_status === event.to_status && (event.note || "").trim()) return statusBadges.neutral ?? "";
  if (event.from_status === "sent" && event.to_status === "sent") return statusBadges.sent ?? "";
  return invoiceEventBadgeClasses[event.to_status] ?? "";
}

function mapInvoiceStatusEvents(
  events: InvoiceStatusEventRecord[],
  statusLabelFn: (status: string) => string,
): StatusEvent[] {
  return events.map((event) => ({
    id: event.id,
    badge: { label: invoiceStatusEventActionLabel(event, statusLabelFn), className: invoiceEventBadgeClass(event) },
    date: formatDateTimeDisplay(event.changed_at, "--"),
    note: event.note,
    actor: event.changed_by_customer_id ? (
      <Link
        href={`/customers?customer=${event.changed_by_customer_id}`}
        onClick={(e) => e.stopPropagation()}
      >
        {event.changed_by_display || `Customer #${event.changed_by_customer_id}`}
      </Link>
    ) : (
      event.changed_by_display || event.changed_by_email || "Unknown user"
    ),
  }));
}

// ---------------------------------------------------------------------------
// Action button helpers
// ---------------------------------------------------------------------------

function invoiceActionButtonColorClass(status: string): string {
  switch (status) {
    case "sent": return styles.actionButtonSent;
    case "closed": return styles.actionButtonClosed;
    case "void": return styles.actionButtonVoid;
    default: return "";
  }
}

function invoiceActionLabel(statusValue: string, currentStatus?: string): string {
  if (statusValue === "sent") return currentStatus === "sent" ? "Re-send" : "Send to Customer";
  if (statusValue === "closed") return "Close Invoice";
  if (statusValue === "void") return "Void Invoice";
  return statusValue;
}

function invoiceConfirmationMessage(
  statusValue: string,
  invoice: InvoiceRecord,
  customerName: string,
  currentStatus?: string,
): string {
  const label = `invoice ${invoice.invoice_number}`;
  const isResend = statusValue === "sent" && currentStatus === "sent";
  if (statusValue === "sent") return `${isResend ? "Re-send" : "Send"} ${label} to ${customerName || "customer"}.`;
  if (statusValue === "closed") return `Close ${label}.`;
  if (statusValue === "void") return `Void ${label}.`;
  return `Transition ${label} to ${statusValue}.`;
}

function invoiceEmailNotice(customerEmail: string, customerId?: number) {
  if (customerEmail) return `Email notification will be sent to ${customerEmail}.`;
  return (
    <>
      No email on file — customer won&apos;t be notified automatically.{" "}
      {customerId ? <Link href={`/customers?customer=${customerId}`}>Edit customer to add email &rarr;</Link> : null}
    </>
  );
}

/** Action confirmation panel for invoices — owns its own expanded/collapsed state. */
function InvoiceActionPanel({
  selectedInvoice,
  nextStatusOptions,
  selectedProject,
  selectedStatus,
  setSelectedStatus,
  statusNote,
  setStatusNote,
  statusLabel,
  viewerActionMessage,
  viewerActionTone,
  onUpdateStatus,
  onAddStatusNote,
  canMutateInvoices,
}: {
  selectedInvoice: InvoiceRecord;
  nextStatusOptions: string[];
  selectedProject: ProjectRecord | null;
  selectedStatus: string;
  setSelectedStatus: (status: string) => void;
  statusNote: string;
  setStatusNote: (note: string) => void;
  statusLabel: (status: string) => string;
  viewerActionMessage: string;
  viewerActionTone: string;
  onUpdateStatus: () => Promise<InvoiceRecord | null>;
  onAddStatusNote: () => void;
  canMutateInvoices: boolean;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customerName = selectedProject?.customer_display_name || "";
  const customerEmail = (selectedProject?.customer_email || "").trim();

  function handleActionClick(statusValue: string) {
    setShareMessage("");
    if (pendingAction === statusValue) {
      setPendingAction(null);
      setSelectedStatus("");
      return;
    }
    setPendingAction(statusValue);
    setSelectedStatus(statusValue);
  }

  async function handleConfirm() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated = await onUpdateStatus();
      if (!updated) return;
      setPendingAction(null);

      if (pendingAction === "sent" && updated.public_ref) {
        const publicUrl = `${window.location.origin}/invoice/${updated.public_ref}`;
        const senderName = (updated.sender_name || "").trim();
        const greeting = customerName ? `Hi ${customerName} — ` : "";
        const from = senderName ? ` from ${senderName}` : "";
        const shareText = `${greeting}here's your invoice${from}:\n${publicUrl}`;

        if (typeof navigator.share === "function") {
          try {
            await navigator.share({ title: `Invoice ${updated.invoice_number}`, text: shareText });
          } catch { /* cancelled */ }
        } else {
          try {
            await navigator.clipboard.writeText(publicUrl);
            setShareMessage("Link copied to clipboard.");
          } catch { /* clipboard unavailable */ }
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCancel() {
    setPendingAction(null);
    setSelectedStatus("");
    setStatusNote("");
  }

  const pendingLabel = pendingAction
    ? invoiceActionLabel(pendingAction, selectedInvoice.status)
    : "";

  return (
    <div className={styles.invoiceViewerSectionContent} onClick={(e) => e.stopPropagation()}>
      {nextStatusOptions.length > 0 && canMutateInvoices ? (
        <div className={styles.actionButtons}>
          {nextStatusOptions.map((status) => {
            const label = invoiceActionLabel(status, selectedInvoice.status);
            const isActive = pendingAction === status;
            return (
              <button
                key={status}
                type="button"
                className={`${styles.invoiceActionButton} ${invoiceActionButtonColorClass(status)} ${
                  isActive ? styles.actionButtonActive : ""
                }`}
                onClick={() => handleActionClick(status)}
                aria-pressed={isActive}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      {!canMutateInvoices ? (
        <p className={styles.inlineHint}>Status actions are read-only for your role.</p>
      ) : nextStatusOptions.length === 0 ? (
        <p className={styles.inlineHint}>{invoiceNextActionHint(selectedInvoice.status)}</p>
      ) : null}

      {pendingAction ? (
        <div className={styles.actionConfirmPanel}>
          <p className={styles.actionConfirmMessage}>
            {invoiceConfirmationMessage(
              pendingAction,
              selectedInvoice,
              customerName,
              selectedInvoice.status,
            )}
          </p>
          <label className={styles.lifecycleField}>
            <span className={styles.lifecycleFieldLabel}>Note (optional)</span>
            <textarea
              className={styles.statusNote}
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              placeholder="Optional note for this action"
              rows={2}
            />
          </label>
          {pendingAction === "sent" ? (
            <p className={styles.actionConfirmDetail}>
              {invoiceEmailNotice(customerEmail, selectedProject?.customer)}
            </p>
          ) : null}
          <div className={styles.actionConfirmActions}>
            <button
              type="button"
              className={styles.invoiceActionButton}
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.invoiceActionButton} ${invoiceActionButtonColorClass(pendingAction)}`}
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? <span className={styles.sendingDots}>Sending</span> : `Confirm ${pendingLabel}`}
            </button>
          </div>
        </div>
      ) : null}

      {!pendingAction && canMutateInvoices ? (
        <label className={styles.lifecycleField}>
          <span className={styles.lifecycleFieldLabel}>Status note</span>
          <textarea
            className={styles.statusNote}
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            placeholder="Add note for this invoice"
            rows={2}
          />
        </label>
      ) : null}

      {viewerActionMessage && viewerActionTone === "success" ? (
        <p className={styles.actionSuccess}>{viewerActionMessage}</p>
      ) : null}
      {viewerActionMessage && viewerActionTone === "error" ? (
        <p className={styles.actionError}>{viewerActionMessage}</p>
      ) : null}
      {shareMessage ? (
        <p className={styles.actionSuccess}>{shareMessage}</p>
      ) : null}

      {!pendingAction && canMutateInvoices ? (
        <div className={styles.lifecycleActions}>
          <button
            type="button"
            className={styles.invoiceActionButton}
            onClick={onAddStatusNote}
            disabled={!statusNote.trim()}
          >
            Add Invoice Status Note
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract breakdown types (local — mirrors parent's inline types)
// ---------------------------------------------------------------------------

type ContractBreakdownQuoteLine = {
  id: number;
  cost_code?: number | null;
  cost_code_code?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  markup_percent: string;
  line_total: string;
};

type ContractBreakdownQuote = {
  id: number;
  title: string;
  version: number;
  grand_total: string;
  line_items: ContractBreakdownQuoteLine[];
};

type ContractBreakdownCO = {
  id: number;
  title: string;
  family_key: string;
  revision_number: number;
  amount_delta: string;
  line_items: Array<{
    id: number;
    cost_code_code?: string;
    description: string;
    adjustment_reason: string;
    amount_delta: string;
    days_delta: number;
  }>;
};

type ContractBreakdown = {
  active_quote: ContractBreakdownQuote | null;
  approved_change_orders: ContractBreakdownCO[];
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvoicesViewerPanelProps = {
  // Project context
  selectedProject: ProjectRecord | null;

  // Search
  invoiceSearch: string;
  onInvoiceSearchChange: (value: string) => void;

  // Status filters
  invoiceStatuses: string[];
  invoiceStatusFilters: string[];
  toggleInvoiceStatusFilter: (status: string) => void;
  invoiceStatusTotals: Map<string, number>;
  statusLabel: (status: string) => string;

  // Invoice rail
  paginatedInvoices: InvoiceRecord[];
  invoices: InvoiceRecord[];
  invoiceNeedle: string;
  selectedInvoiceId: string;
  onSelectInvoice: (invoice: InvoiceRecord) => void;

  // Pagination
  invoicePage: number;
  invoiceTotalPages: number;
  invoiceTotalCount: number;
  setInvoicePage: (page: number) => void;

  // Selected invoice detail
  selectedInvoice: InvoiceRecord | null;
  canMutateInvoices: boolean;

  // Status & actions
  nextStatusOptions: string[];
  selectedStatus: string;
  setSelectedStatus: (status: string) => void;
  statusNote: string;
  setStatusNote: (note: string) => void;
  viewerActionMessage: string;
  viewerActionTone: string;
  onUpdateStatus: () => Promise<InvoiceRecord | null>;
  onAddStatusNote: () => void;

  // History
  selectedInvoiceStatusEvents: InvoiceStatusEventRecord[];
  statusEventsLoading: boolean;

  // Contract breakdown
  contractBreakdown: ContractBreakdown | null;
  isContractBreakdownOpen: boolean;
  setIsContractBreakdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
  workspaceIsLocked: boolean;
  costCodes: CostCode[];
  flashingButtons: Set<string>;
  onDuplicateContractLine: (lineKey: string, fields: Omit<InvoiceLineInput, "localId">) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoicesViewerPanel({
  selectedProject,
  invoiceSearch,
  onInvoiceSearchChange,
  invoiceStatuses,
  invoiceStatusFilters,
  toggleInvoiceStatusFilter,
  invoiceStatusTotals,
  statusLabel,
  paginatedInvoices,
  invoices,
  invoiceNeedle,
  selectedInvoiceId,
  onSelectInvoice,
  invoicePage,
  invoiceTotalPages,
  invoiceTotalCount,
  setInvoicePage,
  selectedInvoice,
  canMutateInvoices,
  nextStatusOptions,
  selectedStatus,
  setSelectedStatus,
  statusNote,
  setStatusNote,
  viewerActionMessage,
  viewerActionTone,
  onUpdateStatus,
  onAddStatusNote,
  selectedInvoiceStatusEvents,
  statusEventsLoading,
  contractBreakdown,
  isContractBreakdownOpen,
  setIsContractBreakdownOpen,
  workspaceIsLocked,
  costCodes,
  flashingButtons,
  onDuplicateContractLine,
}: InvoicesViewerPanelProps) {

  // -------------------------------------------------------------------------
  // Contract breakdown (inline render — mirrors parent's renderContractBreakdown)
  // -------------------------------------------------------------------------

  function renderDuplicateButton(lineKey: string, fields: Omit<InvoiceLineInput, "localId">) {
    return (
      <button
        type="button"
        className={`${styles.contractDuplicateButton}${flashingButtons.has(lineKey) ? ` ${styles.duplicateFlash}` : ""}`}
        title="Add to invoice"
        onClick={() => onDuplicateContractLine(lineKey, fields)}
      >
        +
      </button>
    );
  }

  function renderContractBreakdown() {
    if (!contractBreakdown?.active_quote) return null;
    const quote = contractBreakdown.active_quote;
    const approvedCOs = contractBreakdown.approved_change_orders;
    const hasQuoteLines = quote.line_items.length > 0;
    const hasApprovedCOs = approvedCOs.length > 0;
    if (!hasQuoteLines && !hasApprovedCOs) return null;
    const canDuplicate = !workspaceIsLocked;

    const quoteColumns = ["Cost code", "Description", "Qty", "Unit", "Unit cost", "Markup %", "Line total"];
    const quoteMobileLayout: { order: number; span: "full" | "half"; align?: "left" | "right"; hidden?: boolean }[] = [
      { order: 0, span: "full" },
      { order: 1, span: "full" },
      { order: 2, span: "half", hidden: true },
      { order: 3, span: "half", hidden: true },
      { order: 4, span: "half", hidden: true },
      { order: 5, span: "full" },
      { order: 7, span: "full", align: "right" },
    ];
    const coColumns = ["CO #", "Cost code", "Description", "Days delta", "Amount delta"];
    const coMobileLayout: { order: number; span: "full" | "half"; align?: "left" | "right"; hidden?: boolean }[] = [
      { order: 0, span: "full" },
      { order: 1, span: "half" },
      { order: 2, span: "full" },
      { order: 3, span: "full", align: "right" },
      { order: 5, span: "full", align: "right" },
    ];

    if (canDuplicate) {
      quoteColumns.push("");
      quoteMobileLayout[6] = { order: 7, span: "half", align: "right" };
      quoteMobileLayout.push({ order: 6, span: "half" });
      coColumns.push("");
      coMobileLayout[4] = { order: 5, span: "half", align: "right" };
      coMobileLayout.push({ order: 4, span: "half" });
    }

    return (
      <div className={styles.contractBreakdown}>
        <button
          type="button"
          className={styles.contractBreakdownToggle}
          onClick={() => setIsContractBreakdownOpen((v) => !v)}
          aria-expanded={isContractBreakdownOpen}
        >
          <h4>Contract Breakdown</h4>
          <span className={styles.contractBreakdownArrow}>▼</span>
        </button>

        {isContractBreakdownOpen && hasQuoteLines ? (
          <ReadOnlyLineTable
            caption={`Approved Quote: ${quote.title} v${quote.version}`}
            columns={quoteColumns}
            rows={quote.line_items.map((line) => {
              const qty = parseAmount(line.quantity);
              const markedUpUnitPrice = qty !== 0
                ? formatDecimal(parseAmount(line.line_total) / qty)
                : line.unit_price;
              const unit = line.unit || "ea";
              const costCodeLabel = line.cost_code_code || "—";
              const cells: React.ReactNode[] = [
                costCodeLabel,
                line.description || "—",
                Number(line.quantity).toFixed(2),
                unit,
                `$${Number(line.unit_price).toFixed(2)}`,
                `${line.markup_percent}%`,
                <>
                  <span className={roTableStyles.mobileBreakdown}>
                    {Number(line.quantity).toFixed(2)} {unit} × ${Number(line.unit_price).toFixed(2)}
                    {parseAmount(line.markup_percent) !== 0 ? ` + ${line.markup_percent}%` : ""}
                  </span>
                  <span>${line.line_total}</span>
                </>,
              ];
              if (canDuplicate) {
                cells.push(
                  renderDuplicateButton(`est-${line.id}`, {
                    costCode: line.cost_code ? String(line.cost_code) : "",
                    description: line.description,
                    quantity: line.quantity,
                    unit: line.unit,
                    unitPrice: markedUpUnitPrice,
                  }),
                );
              }
              return { key: line.id, cells };
            })}
            mobileColumnLayout={quoteMobileLayout}
            afterTable={
              <div className={styles.invoiceViewerMetaRow}>
                <span className={styles.invoiceViewerMetaLabel}>Quote grand total</span>
                <strong>${quote.grand_total}</strong>
              </div>
            }
          />
        ) : null}

        {isContractBreakdownOpen && hasApprovedCOs ? (
          <ReadOnlyLineTable
            caption={`Approved Change Orders (${approvedCOs.length})`}
            columns={coColumns}
            rows={approvedCOs.flatMap((co) =>
              co.line_items.map((line) => {
                const costCodeLabel = line.cost_code_code || "—";
                const cells: React.ReactNode[] = [
                  co.title,
                  costCodeLabel,
                  line.description || "—",
                  `${line.days_delta} days`,
                  `$${line.amount_delta}`,
                ];
                if (canDuplicate) {
                  cells.push(
                    renderDuplicateButton(`co-${co.id}-${line.id}`, {
                      costCode: String(costCodes.find((c) => c.code === line.cost_code_code)?.id ?? ""),
                      description: line.description,
                      quantity: "1",
                      unit: "",
                      unitPrice: formatDecimal(parseAmount(line.amount_delta)),
                    }),
                  );
                }
                return { key: `${co.id}-${line.id}`, cells };
              }),
            )}
            mobileColumnLayout={coMobileLayout}
            afterTable={
              <div className={styles.invoiceViewerMetaRow}>
                <span className={styles.invoiceViewerMetaLabel}>Net contract total</span>
                <strong>
                  ${formatDecimal(
                    parseAmount(quote.grand_total) +
                      approvedCOs.reduce((sum, co) => sum + parseAmount(co.amount_delta), 0),
                  )}
                </strong>
              </div>
            }
          />
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className={`${styles.panel} ${styles.viewerPanel}`}>
      <div className={styles.panelHeader}>
        <h3>{selectedProject ? `Invoices for: ${selectedProject.name}` : "Invoices"}</h3>
      </div>

      <input
        className={styles.invoiceSearchInput}
        type="text"
        placeholder="Search invoices..."
        value={invoiceSearch}
        onChange={(e) => onInvoiceSearchChange(e.target.value)}
      />

      <div className={styles.statusFilters}>
        {invoiceStatuses.map((status) => {
          const active = invoiceStatusFilters.includes(status);
          return (
            <button
              key={status}
              type="button"
              className={`${styles.statusFilterPill} ${
                active
                  ? `${styles.statusFilterPillActive} ${invoiceStatusToneClass(status)}`
                  : styles.statusFilterPillInactive
              }`}
              onClick={() => toggleInvoiceStatusFilter(status)}
            >
              <span>{statusLabel(status)}</span>
              <span className={styles.statusFilterCount}>{invoiceStatusTotals.get(status) ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.invoiceRail}>
        {paginatedInvoices.length ? (
          paginatedInvoices.map((invoice) => {
            const isSelected = String(invoice.id) === selectedInvoiceId;
            return (
              <article
                key={invoice.id}
                className={`${styles.invoiceCard} ${invoiceCardStatusClass(invoice.status)} ${
                  isSelected ? styles.invoiceCardSelected : ""
                }`}
                onClick={() => onSelectInvoice(invoice)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectInvoice(invoice);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
              >
                <div className={styles.invoiceCardRow}>
                  <div className={styles.invoiceCardIdentity}>
                    <strong>{invoice.invoice_number}</strong>
                    <span className={`${styles.statusBadge} ${invoiceStatusClass(invoice.status)}`}>
                      {statusLabel(invoice.status)}
                    </span>
                  </div>
                </div>
                <div className={styles.invoiceMetaGrid}>
                  <span><span className={styles.invoiceMetaLabel}>Total</span> ${invoice.total}</span>
                  <span><span className={styles.invoiceMetaLabel}>Due</span> ${invoice.balance_due}</span>
                  <span><span className={styles.invoiceMetaLabel}>Issued</span> {formatDateDisplay(invoice.issue_date)}</span>
                  <span><span className={styles.invoiceMetaLabel}>Due</span> {formatDateDisplay(invoice.due_date)}</span>
                </div>
                {isSelected && selectedInvoice ? (
                  <div className={styles.invoiceExpandedSections}>
                    <InvoiceActionPanel
                      selectedInvoice={selectedInvoice}
                      nextStatusOptions={nextStatusOptions}
                      selectedProject={selectedProject}
                      selectedStatus={selectedStatus}
                      setSelectedStatus={setSelectedStatus}
                      statusNote={statusNote}
                      setStatusNote={setStatusNote}
                      statusLabel={statusLabel}
                      viewerActionMessage={viewerActionMessage}
                      viewerActionTone={viewerActionTone}
                      onUpdateStatus={onUpdateStatus}
                      onAddStatusNote={onAddStatusNote}
                      canMutateInvoices={canMutateInvoices}
                    />

                    {selectedInvoiceStatusEvents.length > 0 ? (
                      <StatusEvents events={mapInvoiceStatusEvents(selectedInvoiceStatusEvents, statusLabel)} />
                    ) : statusEventsLoading ? (
                      <p className={styles.inlineHint}>Loading status history...</p>
                    ) : null}

                    {renderContractBreakdown()}
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <p className={styles.emptyState}>
            {invoices.length
              ? invoiceNeedle
                ? "No invoices match your search."
                : "No invoices match the selected status filters."
              : "No invoices yet for this project."}
          </p>
        )}
      </div>
      <PaginationControls page={invoicePage} totalPages={invoiceTotalPages} totalCount={invoiceTotalCount} onPageChange={setInvoicePage} />
    </section>
  );
}
