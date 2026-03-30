/**
 * Vendor bills viewer panel — bill table (desktop) / card list (mobile),
 * status filter pills, and inline expandable sections for the selected bill.
 *
 * Pure presentational: all state and handlers come from the console orchestrator.
 */

import { formatDateDisplay } from "@/shared/date-format";
import {
  collapseToggleButtonStyles as collapseButtonStyles,
} from "@/shared/project-list-viewer";
import { StatusEvents, type StatusEvent } from "@/shared/status-events/status-events";
import statusBadges from "@/shared/styles/status.module.css";
import type {
  ProjectRecord,
  VendorBillRecord,
  VendorBillSnapshotRecord,
  VendorBillStatus,
} from "../types";
import styles from "./vendor-bills-console.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VendorBillsViewerPanelProps = {
  isMobile: boolean;
  selectedProject: ProjectRecord | null;
  isViewerExpanded: boolean;
  setIsViewerExpanded: (fn: (v: boolean) => boolean) => void;

  // Status filters
  billStatuses: string[];
  billStatusFilters: string[];
  billStatusCounts: Record<string, number>;
  billStatusLabels: Record<string, string>;
  toggleBillStatusFilter: (status: string) => void;
  setBillStatusFilters: (fn: string[] | ((prev: string[]) => string[])) => void;
  defaultBillStatusFiltersFn: (statuses: string[]) => string[];

  // Bill list
  filteredVendorBills: VendorBillRecord[];
  selectedVendorBillId: string;
  onSelectVendorBill: (id: string) => void;

  // Viewer sections
  canMutateVendorBills: boolean;
  quickStatusOptions: string[];
  viewerNextStatus: string;
  setViewerNextStatus: (s: string) => void;
  viewerNote: string;
  setViewerNote: (s: string) => void;
  viewerErrorMessage: string;
  onUpdateStatus: () => void;
  onUpdateNote: () => void;

  // Expandable sections
  isStatusSectionOpen: boolean;
  setIsStatusSectionOpen: (fn: (v: boolean) => boolean) => void;
  isLineItemsSectionOpen: boolean;
  setIsLineItemsSectionOpen: (fn: (v: boolean) => boolean) => void;
  isDetailsSectionOpen: boolean;
  setIsDetailsSectionOpen: (fn: (v: boolean) => boolean) => void;
  isHistorySectionOpen: boolean;
  setIsHistorySectionOpen: (fn: (v: boolean) => boolean) => void;
  snapshots: VendorBillSnapshotRecord[];
};

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function statusDisplayLabel(value: VendorBillStatus, labels: Record<string, string>): string {
  return labels[value] ?? value;
}

function statusBadgeClass(value: VendorBillStatus): string {
  return styles[`tableStatus${value[0].toUpperCase()}${value.slice(1)}`] ?? "";
}

const vendorBillEventBadgeClasses: Record<string, string> = {
  open: statusBadges.open ?? "",
  disputed: statusBadges.disputed ?? "",
  closed: statusBadges.closed ?? "",
  void: statusBadges.void ?? "",
};

function mapVendorBillSnapshots(
  snaps: VendorBillSnapshotRecord[],
  labels: Record<string, string>,
): StatusEvent[] {
  return snaps.map((snap) => ({
    id: snap.id,
    badge: {
      label: snap.action_type === "notate"
        ? "Note"
        : statusDisplayLabel(snap.capture_status as VendorBillStatus, labels),
      className: snap.action_type === "notate"
        ? statusBadges.neutral ?? ""
        : vendorBillEventBadgeClasses[snap.capture_status] ?? "",
    },
    date: formatDateDisplay(snap.created_at),
    note: snap.status_note,
    actor: snap.acted_by_display || snap.acted_by_email || "Unknown",
  }));
}

function statusPillClass(value: VendorBillStatus): string {
  return styles[`statusPill${value[0].toUpperCase()}${value.slice(1)}`] ?? "";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VendorBillsViewerPanel(props: VendorBillsViewerPanelProps) {
  const {
    isMobile,
    selectedProject,
    isViewerExpanded,
    setIsViewerExpanded,
    billStatuses,
    billStatusFilters,
    billStatusCounts,
    billStatusLabels,
    toggleBillStatusFilter,
    setBillStatusFilters,
    defaultBillStatusFiltersFn,
    filteredVendorBills,
    selectedVendorBillId,
    onSelectVendorBill,
    canMutateVendorBills,
    quickStatusOptions,
    viewerNextStatus,
    setViewerNextStatus,
    viewerNote,
    setViewerNote,
    viewerErrorMessage,
    onUpdateStatus,
    onUpdateNote,
    isStatusSectionOpen,
    setIsStatusSectionOpen,
    isLineItemsSectionOpen,
    setIsLineItemsSectionOpen,
    isDetailsSectionOpen,
    setIsDetailsSectionOpen,
    isHistorySectionOpen,
    setIsHistorySectionOpen,
    snapshots,
  } = props;

  // -------------------------------------------------------------------------
  // Expanded sections renderer
  // -------------------------------------------------------------------------

  function renderExpandedSections(vendorBill: VendorBillRecord) {
    return (
      <div className={styles.expandedSections} onClick={(e) => e.stopPropagation()}>
        {/* Status & Actions */}
        <div className={styles.viewerSection}>
          <button
            type="button"
            className={styles.viewerSectionToggle}
            onClick={(e) => { e.stopPropagation(); setIsStatusSectionOpen((v) => !v); }}
            aria-expanded={isStatusSectionOpen}
          >
            <h4>Status &amp; Actions</h4>
            <span className={styles.viewerSectionArrow}>&#9660;</span>
          </button>
          {isStatusSectionOpen ? (
            <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
              {quickStatusOptions.length > 0 ? (
                <>
                  <span className={styles.lifecycleFieldLabel}>Next status</span>
                  <div className={styles.statusPills}>
                    {quickStatusOptions.map((statusOption) => {
                      const active = statusOption === viewerNextStatus;
                      return (
                        <button
                          key={`viewer-status-${statusOption}`}
                          type="button"
                          className={`${styles.statusPill} ${
                            active ? statusPillClass(statusOption) : styles.statusPillInactive
                          } ${active ? styles.statusPillActive : ""}`}
                          aria-pressed={active}
                          onClick={() => setViewerNextStatus(statusOption)}
                        >
                          {statusDisplayLabel(statusOption, billStatusLabels)}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className={styles.viewerHint}>No next statuses available for this bill.</p>
              )}
              <label className={styles.statusPickerLabel}>
                Note
                <textarea
                  className={styles.viewerNoteInput}
                  value={viewerNote}
                  onChange={(e) => setViewerNote(e.target.value)}
                  placeholder="Optional note..."
                  disabled={!canMutateVendorBills}
                />
              </label>
              <div className={styles.viewerStatusActions}>
                <button
                  type="button"
                  className={styles.formPrimaryButton}
                  onClick={() => void onUpdateStatus()}
                  disabled={!selectedVendorBillId || !viewerNextStatus || !canMutateVendorBills}
                >
                  Update Status
                </button>
                <button
                  type="button"
                  className={styles.formSecondaryButton}
                  onClick={() => void onUpdateNote()}
                  disabled={!selectedVendorBillId || !canMutateVendorBills}
                >
                  Update Note
                </button>
              </div>
              {viewerErrorMessage ? (
                <p className={styles.viewerErrorText} role="alert" aria-live="polite">
                  {viewerErrorMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Line Items */}
        <div className={styles.viewerSection}>
          <button
            type="button"
            className={styles.viewerSectionToggle}
            onClick={(e) => { e.stopPropagation(); setIsLineItemsSectionOpen((v) => !v); }}
            aria-expanded={isLineItemsSectionOpen}
          >
            <h4>Line Items ({vendorBill.line_items?.length ?? 0})</h4>
            <span className={styles.viewerSectionArrow}>&#9660;</span>
          </button>
          {isLineItemsSectionOpen ? (
            <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
              {vendorBill.line_items && vendorBill.line_items.length > 0 ? (
                <div className={styles.readOnlyTableWrap}>
                  <table className={styles.readOnlyTable}>
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Unit Price</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorBill.line_items.map((lineItem, lineIdx) => (
                        <tr key={lineIdx}>
                          <td>{lineItem.description || "—"}</td>
                          <td>{lineItem.quantity}</td>
                          <td>${lineItem.unit_price}</td>
                          <td>${lineItem.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.viewerHint}>No line items on this bill.</p>
              )}
            </div>
          ) : null}
        </div>

        {/* Bill Details */}
        <div className={styles.viewerSection}>
          <button
            type="button"
            className={styles.viewerSectionToggle}
            onClick={(e) => { e.stopPropagation(); setIsDetailsSectionOpen((v) => !v); }}
            aria-expanded={isDetailsSectionOpen}
          >
            <h4>Bill Details</h4>
            <span className={styles.viewerSectionArrow}>&#9660;</span>
          </button>
          {isDetailsSectionOpen ? (
            <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
              <div className={styles.detailGrid}>
                <div>
                  <p className={styles.detailLabel}>Vendor</p>
                  <p className={styles.detailValue}>{vendorBill.vendor_name || "Expense"}</p>
                </div>
                <div>
                  <p className={styles.detailLabel}>Bill #</p>
                  <p className={styles.detailValue}>{vendorBill.bill_number}</p>
                </div>
                <div>
                  <p className={styles.detailLabel}>Issue Date</p>
                  <p className={styles.detailValue}>{formatDateDisplay(vendorBill.issue_date)}</p>
                </div>
                <div>
                  <p className={styles.detailLabel}>Due Date</p>
                  <p className={styles.detailValue}>{formatDateDisplay(vendorBill.due_date)}</p>
                </div>
                <div>
                  <p className={styles.detailLabel}>Total</p>
                  <p className={styles.detailValue}>${vendorBill.total}</p>
                </div>
                <div>
                  <p className={styles.detailLabel}>Balance Due</p>
                  <p className={styles.detailValue}>${vendorBill.balance_due}</p>
                </div>
                {vendorBill.notes ? (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <p className={styles.detailLabel}>Notes</p>
                    <p className={styles.detailValue}>{vendorBill.notes}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Status History */}
        {snapshots.length > 0 ? (
          <div className={styles.viewerSection}>
            <button
              type="button"
              className={styles.viewerSectionToggle}
              onClick={(e) => { e.stopPropagation(); setIsHistorySectionOpen((v) => !v); }}
              aria-expanded={isHistorySectionOpen}
            >
              <h4>Status History ({snapshots.length})</h4>
              <span className={styles.viewerSectionArrow}>&#9660;</span>
            </button>
            {isHistorySectionOpen ? (
              <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
                <StatusEvents events={mapVendorBillSnapshots(snapshots, billStatusLabels)} title="" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className={styles.viewerPanel}>
      <div className={styles.panelHeader}>
        <h3>{selectedProject ? `Bills for: ${selectedProject.name}` : "Bills"}</h3>
        {!isMobile ? (
          <button
            type="button"
            className={collapseButtonStyles.collapseButton}
            style={{ background: "var(--surface)" }}
            onClick={() => setIsViewerExpanded((current) => !current)}
            aria-expanded={isViewerExpanded}
          >
            {isViewerExpanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
      </div>

      {(isMobile || isViewerExpanded) ? (
      <>
      <div className={styles.statusFilters}>
        <div className={styles.statusFilterButtons}>
          {billStatuses.map((statusValue) => {
            const active = billStatusFilters.includes(statusValue);
            const statusClass = `statusFilter${statusValue[0].toUpperCase()}${statusValue.slice(1)}`;
            return (
              <button
                key={statusValue}
                type="button"
                className={`${styles.filterPill} ${
                  active
                    ? `${styles.filterPillActive} ${styles[statusClass] ?? ""}`
                    : styles.filterPillInactive
                }`}
                aria-pressed={active}
                onClick={() => toggleBillStatusFilter(statusValue)}
              >
                <span>{statusDisplayLabel(statusValue, billStatusLabels)}</span>
                <span className={styles.filterPillCount}>{billStatusCounts[statusValue] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.filterActions}>
          <button
            type="button"
            className={styles.filterActionButton}
            onClick={() => { setBillStatusFilters([...billStatuses]); }}
          >
            Show All
          </button>
          <button
            type="button"
            className={styles.filterActionButton}
            onClick={() => { setBillStatusFilters(defaultBillStatusFiltersFn(billStatuses)); }}
          >
            Reset Filters
          </button>
        </div>
      </div>

      {isMobile ? (
        /* ── Mobile: card list ── */
        <div className={styles.billCardList}>
          {filteredVendorBills.length ? (
            filteredVendorBills.map((vendorBill) => {
              const isSelected = selectedVendorBillId === String(vendorBill.id);
              return (
                <div
                  key={vendorBill.id}
                  className={`${styles.billCard} ${isSelected ? styles.billCardSelected : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectVendorBill(String(vendorBill.id))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectVendorBill(String(vendorBill.id));
                    }
                  }}
                >
                  <div className={styles.billCardTop}>
                    <div className={styles.billCardIdentity}>
                      <span className={styles.billCardVendor}>{vendorBill.vendor_name || "Expense"}</span>
                      <span className={styles.billCardMeta}>
                        #{vendorBill.id} {vendorBill.bill_number}
                        {vendorBill.due_date ? ` · Due ${formatDateDisplay(vendorBill.due_date)}` : ""}
                      </span>
                    </div>
                    <div className={styles.billCardAmountBlock}>
                      <span className={styles.billCardAmount}>${vendorBill.total}</span>
                      {Number(vendorBill.balance_due) > 0 && Number(vendorBill.balance_due) < Number(vendorBill.total) ? (
                        <span className={styles.billCardBalance}>{`$${vendorBill.balance_due} due`}</span>
                      ) : Number(vendorBill.balance_due) <= 0 && Number(vendorBill.total) > 0 ? (
                        <span className={styles.billCardBalancePaid}>Paid</span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.billCardFooter}>
                    <span className={`${styles.tableStatusBadge} ${statusBadgeClass(vendorBill.status)}`}>
                      {statusDisplayLabel(vendorBill.status, billStatusLabels)}
                    </span>
                  </div>
                  {isSelected ? renderExpandedSections(vendorBill) : null}
                </div>
              );
            })
          ) : (
            <p className={styles.viewerHint}>No bills match the selected status/due filters.</p>
          )}
        </div>
      ) : (
        /* ── Desktop: table ── */
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Due</th>
                <th>Total</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredVendorBills.length ? (
                filteredVendorBills.map((vendorBill) => {
                  const isSelected = selectedVendorBillId === String(vendorBill.id);
                  return [
                    <tr
                      key={vendorBill.id}
                      className={isSelected ? styles.rowSelected : ""}
                      onClick={() => onSelectVendorBill(String(vendorBill.id))}
                    >
                      <td>
                        <strong>#{vendorBill.id}</strong> {vendorBill.bill_number}
                      </td>
                      <td>{vendorBill.vendor_name || "Expense"}</td>
                      <td>
                        <span className={`${styles.tableStatusBadge} ${statusBadgeClass(vendorBill.status)}`}>
                          {statusDisplayLabel(vendorBill.status, billStatusLabels)}
                        </span>
                      </td>
                      <td>{formatDateDisplay(vendorBill.due_date)}</td>
                      <td>${vendorBill.total}</td>
                      <td>${vendorBill.balance_due}</td>
                    </tr>,
                    isSelected ? (
                      <tr key={`expanded-${vendorBill.id}`} className={styles.expandedRow}>
                        <td colSpan={6}>
                          {renderExpandedSections(vendorBill)}
                        </td>
                      </tr>
                    ) : null,
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={6} className={styles.projectEmptyCell}>
                    No bills match the selected status/due filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      </>
      ) : null}
    </div>
  );
}
