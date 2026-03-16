/**
 * Presentational component for the invoices viewer panel.
 *
 * Renders the invoice list with status filters, search, pagination,
 * and expanded invoice detail (status & actions, status history,
 * line items, contract breakdown). All data and handlers are received
 * via props — no hooks or side effects live here.
 *
 * Extracted from invoices-console.tsx to reduce component size.
 */

import Link from "next/link";
import { formatDateDisplay, formatDateTimeDisplay } from "@/shared/date-format";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import { PaginationControls } from "@/shared/components/pagination-controls";
import {
  invoiceNextActionHint,
  invoiceStatusEventActionLabel,
  publicInvoiceHref,
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
  if (status === "partially_paid") return styles.statusPartial;
  if (status === "paid") return styles.statusPaid;
  if (status === "void") return styles.statusVoid;
  return "";
}

/** Map an invoice status to its tone class for inline status accents. */
function invoiceStatusToneClass(status: string): string {
  if (status === "draft") return styles.statusToneDraft;
  if (status === "sent") return styles.statusToneSent;
  if (status === "partially_paid") return styles.statusTonePartial;
  if (status === "paid") return styles.statusTonePaid;
  if (status === "void") return styles.statusToneVoid;
  return "";
}

/** Map an invoice status to its card-level CSS class for list card border/accent. */
function invoiceCardStatusClass(status: string): string {
  if (status === "draft") return styles.invoiceCardStatusDraft;
  if (status === "sent") return styles.invoiceCardStatusSent;
  if (status === "partially_paid") return styles.invoiceCardStatusPartial;
  if (status === "paid") return styles.invoiceCardStatusPaid;
  if (status === "void") return styles.invoiceCardStatusVoid;
  return "";
}

/** Map a status event to its visual tone class for the history timeline. */
function invoiceStatusEventToneClass(event: InvoiceStatusEventRecord): string {
  if (event.action_type === "resend" || (event.from_status === "sent" && event.to_status === "sent")) {
    return styles.statusToneSent;
  }
  if (event.action_type === "notate" || (event.from_status === event.to_status && (event.note || "").trim())) {
    return styles.statusToneNotate;
  }
  return invoiceStatusToneClass(event.to_status);
}

// ---------------------------------------------------------------------------
// Contract breakdown types (local — mirrors parent's inline types)
// ---------------------------------------------------------------------------

type ContractBreakdownEstimateLine = {
  id: number;
  cost_code?: number | null;
  cost_code_code?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost: string;
  markup_percent: string;
  line_total: string;
};

type ContractBreakdownEstimate = {
  id: number;
  title: string;
  version: number;
  grand_total: string;
  line_items: ContractBreakdownEstimateLine[];
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
  active_estimate: ContractBreakdownEstimate | null;
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
  onUpdateStatus: () => void;
  onAddStatusNote: () => void;

  // History
  selectedInvoiceStatusEvents: InvoiceStatusEventRecord[];
  statusEventsLoading: boolean;
  showAllEvents: boolean;
  setShowAllEvents: React.Dispatch<React.SetStateAction<boolean>>;

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
  showAllEvents,
  setShowAllEvents,
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
    if (!contractBreakdown?.active_estimate) return null;
    const estimate = contractBreakdown.active_estimate;
    const approvedCOs = contractBreakdown.approved_change_orders;
    const hasEstimateLines = estimate.line_items.length > 0;
    const hasApprovedCOs = approvedCOs.length > 0;
    if (!hasEstimateLines && !hasApprovedCOs) return null;
    const canDuplicate = !workspaceIsLocked;

    const estimateColumns = ["Cost code", "Description", "Qty", "Unit", "Unit cost", "Markup %", "Line total"];
    const estimateMobileLayout: { order: number; span: "full" | "half"; align?: "left" | "right"; hidden?: boolean }[] = [
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
      estimateColumns.push("");
      estimateMobileLayout[6] = { order: 7, span: "half", align: "right" };
      estimateMobileLayout.push({ order: 6, span: "half" });
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

        {isContractBreakdownOpen && hasEstimateLines ? (
          <ReadOnlyLineTable
            caption={`Approved Estimate: ${estimate.title} v${estimate.version}`}
            columns={estimateColumns}
            rows={estimate.line_items.map((line) => {
              const qty = parseAmount(line.quantity);
              const markedUpUnitPrice = qty !== 0
                ? formatDecimal(parseAmount(line.line_total) / qty)
                : line.unit_cost;
              const unit = line.unit || "ea";
              const costCodeLabel = line.cost_code_code || "—";
              const cells: React.ReactNode[] = [
                costCodeLabel,
                line.description || "—",
                Number(line.quantity).toFixed(2),
                unit,
                `$${Number(line.unit_cost).toFixed(2)}`,
                `${line.markup_percent}%`,
                <>
                  <span className={roTableStyles.mobileBreakdown}>
                    {Number(line.quantity).toFixed(2)} {unit} × ${Number(line.unit_cost).toFixed(2)}
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
            mobileColumnLayout={estimateMobileLayout}
            afterTable={
              <div className={styles.invoiceViewerMetaRow}>
                <span className={styles.invoiceViewerMetaLabel}>Estimate grand total</span>
                <strong>${estimate.grand_total}</strong>
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
                    parseAmount(estimate.grand_total) +
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
                {invoice.public_ref ? (
                  <div className={styles.invoiceLinkBar}>
                    <a
                      href={publicInvoiceHref(invoice.public_ref)}
                      className={styles.invoiceLinkBarLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      Customer View →
                    </a>
                  </div>
                ) : null}

                {isSelected && selectedInvoice ? (
                  <div className={styles.invoiceExpandedSections}>
                    {/* Status & Actions */}
                    <div className={styles.invoiceViewerSection}>
                      <h4 className={styles.invoiceViewerSectionHeading}>Status &amp; Actions</h4>
                        <div className={styles.invoiceViewerSectionContent}>
                          <p className={styles.inlineHint}>{invoiceNextActionHint(selectedInvoice.status)}</p>
                          {canMutateInvoices ? (
                            <>
                              {nextStatusOptions.length > 0 ? (
                                <>
                                  <span className={styles.lifecycleFieldLabel}>Next status</span>
                                  <div className={styles.invoiceQuickStatusPills}>
                                    {nextStatusOptions.map((status) => {
                                      const isActive = selectedStatus === status;
                                      return (
                                        <button
                                          key={status}
                                          type="button"
                                          className={`${styles.invoiceQuickStatusButton} ${
                                            isActive
                                              ? `${styles.invoiceQuickStatusButtonActive} ${invoiceStatusToneClass(status)}`
                                              : styles.invoiceQuickStatusButtonInactive
                                          }`}
                                          onClick={(e) => { e.stopPropagation(); setSelectedStatus(status); }}
                                          aria-pressed={isActive}
                                        >
                                          {selectedInvoice.status === "sent" && status === "sent"
                                            ? "Re-send"
                                            : statusLabel(status)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {selectedStatus === "sent" && !selectedProject?.customer_email?.trim() ? (
                                    <p className={styles.invoiceViewerActionError}>WARNING: This customer has no email on file and will not receive an automated email.</p>
                                  ) : null}
                                </>
                              ) : (
                                <p className={styles.inlineHint}>No next statuses available.</p>
                              )}
                              <label className={styles.invoiceViewerField} onClick={(e) => e.stopPropagation()}>
                                Status note
                                <textarea
                                  value={statusNote}
                                  onChange={(e) => setStatusNote(e.target.value)}
                                  placeholder="Optional note for this status action or history-only note."
                                  rows={2}
                                />
                              </label>
                              {viewerActionMessage ? (
                                <p
                                  className={viewerActionTone === "error" ? styles.invoiceViewerActionError : styles.invoiceViewerActionSuccess}
                                  role="status"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {viewerActionMessage}
                                </p>
                              ) : null}
                              <div className={styles.invoiceViewerActionRow}>
                                {nextStatusOptions.length > 0 ? (
                                  <button
                                    type="button"
                                    className={`${styles.invoiceViewerActionButton} ${styles.invoiceViewerActionButtonPrimary}`}
                                    onClick={(e) => { e.stopPropagation(); onUpdateStatus(); }}
                                    disabled={!selectedStatus}
                                  >
                                    Update Status
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={`${styles.invoiceViewerActionButton} ${styles.invoiceViewerActionButtonSecondary}`}
                                  onClick={(e) => { e.stopPropagation(); onAddStatusNote(); }}
                                  disabled={!statusNote.trim()}
                                >
                                  Add Status Note
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className={styles.inlineHint}>Status actions are read-only for your role.</p>
                          )}
                        </div>
                    </div>

                    {/* History */}
                    <div className={styles.invoiceViewerSection}>
                      <h4 className={styles.invoiceViewerSectionHeading}>History ({selectedInvoiceStatusEvents.length})</h4>
                        <div className={styles.invoiceViewerSectionContent}>
                          {selectedInvoiceStatusEvents.length > 0 ? (
                            <>
                              <ul className={styles.invoiceViewerEventList}>
                                {(showAllEvents
                                  ? selectedInvoiceStatusEvents
                                  : selectedInvoiceStatusEvents.slice(0, 4)
                                ).map((event) => (
                                  <li key={event.id} className={styles.invoiceViewerEventItem}>
                                    <span className={`${styles.invoiceViewerEventAction} ${invoiceStatusEventToneClass(event)}`}>
                                      {invoiceStatusEventActionLabel(event, statusLabel)}
                                    </span>
                                    <span className={styles.invoiceViewerEventMeta}>
                                      {formatDateTimeDisplay(event.changed_at, "--")} by{" "}
                                      {event.changed_by_customer_id ? (
                                        <Link
                                          href={`/customers?customer=${event.changed_by_customer_id}`}
                                          className={styles.statusActorLink}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {event.changed_by_display || `Customer #${event.changed_by_customer_id}`}
                                        </Link>
                                      ) : (
                                        event.changed_by_display || event.changed_by_email || `User #${event.changed_by}`
                                      )}
                                    </span>
                                    {event.note ? (
                                      <span className={styles.invoiceViewerEventNote}>{event.note}</span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                              {selectedInvoiceStatusEvents.length > 4 ? (
                                <button
                                  type="button"
                                  className={styles.invoiceShowAllToggle}
                                  onClick={(e) => { e.stopPropagation(); setShowAllEvents((v) => !v); }}
                                >
                                  {showAllEvents
                                    ? "Show less"
                                    : `Show all ${selectedInvoiceStatusEvents.length} events`}
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <p className={styles.inlineHint}>
                              {statusEventsLoading ? "Loading status history..." : "No status history yet."}
                            </p>
                          )}
                        </div>
                    </div>

                    {/* Line Items */}
                    <div className={styles.invoiceViewerSection}>
                      <h4 className={styles.invoiceViewerSectionHeading}>Line Items ({invoice.line_items?.length ?? 0})</h4>
                        <div className={styles.invoiceViewerSectionContent}>
                          <ReadOnlyLineTable
                            columns={["Description", "Qty", "Unit", "Unit Price", "Line Total"]}
                            rows={(invoice.line_items ?? []).map((line) => ({
                              key: line.id,
                              cells: [
                                line.description || "—",
                                line.quantity,
                                line.unit,
                                `$${line.unit_price}`,
                                `$${line.line_total}`,
                              ],
                            }))}
                            emptyMessage="No line items."
                            mobileColumnLayout={[
                              { order: 0, span: "full" },
                              { order: 1, span: "half" },
                              { order: 2, span: "half" },
                              { order: 3, span: "half" },
                              { order: 4, span: "half", align: "right" },
                            ]}
                          />
                        </div>
                    </div>

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
