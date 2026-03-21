/**
 * Presentational component for the change-orders viewer panel.
 *
 * Renders the estimate rail, CO list with pagination, status & actions,
 * audit event history, line items detail, and contract breakdown. All
 * data and handlers are received via props -- no hooks or side effects
 * live here.
 *
 * Parent: ChangeOrdersConsole
 */

import Link from "next/link";
import { collapseToggleButtonStyles as collapseButtonStyles } from "@/shared/project-list-viewer";
import { PaginationControls } from "@/shared/components/pagination-controls";
import {
  coLabel,
  publicChangeOrderHref,
} from "../helpers";
import {
  statusLabel,
  quickStatusControlLabel,
  formatEventDateTime,
  eventActorLabel,
  eventActorHref,
  statusEventActionLabel,
  approvalMeta,
  approvedRollingDeltaForEstimate,
  originalBudgetTotalForEstimate,
  currentApprovedBudgetTotalForEstimate,
  lastStatusEventForChangeOrder,
} from "./change-orders-display";
import type {
  AuditEventRecord,
  ChangeOrderRecord,
  OriginEstimateRecord,
} from "../types";
import styles from "./change-orders-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";

// ---------------------------------------------------------------------------
// Pure display helpers (CSS-dependent -- kept local)
// ---------------------------------------------------------------------------

function quickStatusToneClass(status: string): string {
  const key = `quickStatus${status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
  return styles[key] ?? "";
}

function statusEventActionClass(event: AuditEventRecord): string {
  const toStatus = event.to_status || "";
  const fromStatus = event.from_status || "";
  const statusAction = String(event.metadata_json?.status_action || "").toLowerCase();
  if (statusAction === "notate") return styles.statusEventNeutral;
  if (statusAction === "resend") return styles.statusEventSent;
  if (!fromStatus && toStatus === "draft") return styles.statusEventCreated;
  if (fromStatus === toStatus && (event.note || "").trim()) return styles.statusEventNeutral;
  if (fromStatus === "pending_approval" && toStatus === "pending_approval") return styles.statusEventSent;
  if (fromStatus === "draft" && toStatus === "pending_approval") return styles.statusEventSent;
  if (toStatus === "approved") return styles.statusEventApproved;
  if (toStatus === "rejected") return styles.statusEventRejected;
  if (toStatus === "void") return styles.statusEventVoid;
  if (toStatus === "draft" && fromStatus) return styles.statusEventReturnedDraft;
  return styles.statusEventNeutral;
}

function viewerHistoryStatusClass(status: string): string {
  const key = `viewerHistory${status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
  return styles[key] ?? "";
}

/** Render the actor label, optionally as a customer link. */
function renderEventActor(event: AuditEventRecord) {
  const label = eventActorLabel(event);
  const href = eventActorHref(event);
  if (!href) return label;
  return (
    <Link href={href} className={styles.eventActorLink}>
      {label}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeOrdersViewerPanelProps = {
  // Layout
  isMobile: boolean;
  isViewerExpanded: boolean;
  setIsViewerExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  // Project context
  selectedProjectId: string;
  selectedProjectName: string;
  selectedProjectCustomerEmail: string;

  // Estimate rail
  projectEstimates: OriginEstimateRecord[];
  selectedViewerEstimateId: string;
  changeOrders: ChangeOrderRecord[];
  originEstimateOriginalTotals: Record<number, number>;
  onSelectEstimate: (estimateId: string) => void;

  // CO list
  selectedViewerEstimate: OriginEstimateRecord | null;
  viewerChangeOrders: ChangeOrderRecord[];
  paginatedChangeOrders: ChangeOrderRecord[];
  selectedChangeOrderId: string;
  coPage: number;
  coTotalPages: number;
  coTotalCount: number;
  setCoPage: (page: number) => void;
  onSelectChangeOrder: (changeOrder: ChangeOrderRecord) => void;
  projectAuditEvents: AuditEventRecord[];
  changeOrderStatusLabels: Record<string, string>;

  // Selected CO detail
  selectedViewerChangeOrder: ChangeOrderRecord | null;
  selectedViewerWorkingTotals: { preApproval: string; postApproval: string };
  approvedCOsForSelectedEstimate: ChangeOrderRecord[];

  // Status & actions
  canMutateChangeOrders: boolean;
  quickStatusOptions: string[];
  quickStatus: string;
  setQuickStatus: (status: string) => void;
  quickStatusNote: string;
  setQuickStatusNote: (note: string) => void;
  onQuickUpdateStatus: () => void;
  onAddChangeOrderStatusNote: () => void;

  // Action feedback
  actionMessage: string;
  actionTone: string;

  // Collapsible sections
  isStatusSectionOpen: boolean;
  setIsStatusSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isHistorySectionOpen: boolean;
  setIsHistorySectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isLineItemsSectionOpen: boolean;
  setIsLineItemsSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isOriginLineItemsSectionOpen: boolean;
  setIsOriginLineItemsSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // History
  selectedChangeOrderStatusEvents: AuditEventRecord[];
  showAllEvents: boolean;
  setShowAllEvents: React.Dispatch<React.SetStateAction<boolean>>;

};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChangeOrdersViewerPanel({
  isMobile,
  isViewerExpanded,
  setIsViewerExpanded,
  selectedProjectId,
  selectedProjectName,
  selectedProjectCustomerEmail,
  projectEstimates,
  selectedViewerEstimateId,
  changeOrders,
  originEstimateOriginalTotals,
  onSelectEstimate,
  selectedViewerEstimate,
  viewerChangeOrders,
  paginatedChangeOrders,
  selectedChangeOrderId,
  coPage,
  coTotalPages,
  coTotalCount,
  setCoPage,
  onSelectChangeOrder,
  projectAuditEvents,
  changeOrderStatusLabels,
  selectedViewerChangeOrder,
  selectedViewerWorkingTotals,
  approvedCOsForSelectedEstimate,
  canMutateChangeOrders,
  quickStatusOptions,
  quickStatus,
  setQuickStatus,
  quickStatusNote,
  setQuickStatusNote,
  onQuickUpdateStatus,
  onAddChangeOrderStatusNote,
  actionMessage,
  actionTone,
  isStatusSectionOpen,
  setIsStatusSectionOpen,
  isHistorySectionOpen,
  setIsHistorySectionOpen,
  isLineItemsSectionOpen,
  setIsLineItemsSectionOpen,
  isOriginLineItemsSectionOpen,
  setIsOriginLineItemsSectionOpen,
  selectedChangeOrderStatusEvents,
  showAllEvents,
  setShowAllEvents,
}: ChangeOrdersViewerPanelProps) {
  return (
    <section className={styles.viewer}>
      <div className={styles.viewerHeader}>
        <div className={styles.viewerHeaderRow}>
          <h3>{selectedProjectName ? `Change Orders for: ${selectedProjectName}` : "Change Orders"}</h3>
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
        <p>
          Select an estimate to view its change orders.
        </p>
      </div>
      {(isMobile || isViewerExpanded) ? (projectEstimates.length > 0 ? (
        <div className={styles.viewerGrid}>
          <div className={styles.viewerRail}>
            <div className={styles.viewerRailHeader}>
              <span className={styles.viewerRailHeading}>Approved Estimates</span>
            </div>
            {projectEstimates.map((estimate) => {
              const active = String(estimate.id) === selectedViewerEstimateId;
              const relatedCount = changeOrders.filter(
                (changeOrder) => changeOrder.origin_estimate === estimate.id,
              ).length;
              return (
                <div key={estimate.id} className={styles.viewerRailEntry}>
                  <button
                    type="button"
                    className={`${styles.viewerRailItem} ${active ? styles.viewerRailItemActive : ""}`}
                    onClick={() => onSelectEstimate(String(estimate.id))}
                  >
                    <span className={styles.viewerRailTitle}>
                      {estimate.title}
                      <span className={styles.viewerRailVersion}>
                        Estimate #{estimate.id} · {relatedCount} COs
                      </span>
                    </span>
                    <span className={styles.viewerRailSubtext}>
                      {approvalMeta(estimate)}
                    </span>
                    <span className={styles.viewerRailMetrics}>
                      <span className={styles.viewerMetricCurrent}>
                        Current ${currentApprovedBudgetTotalForEstimate(estimate.id, changeOrders, originEstimateOriginalTotals)}
                      </span>
                      {" · "}
                      <span className={styles.viewerMetricOriginal}>
                        Original ${originalBudgetTotalForEstimate(estimate.id, originEstimateOriginalTotals)}
                      </span>
                      {" · "}
                      <span className={styles.viewerMetricDelta}>
                        CO Delta ${approvedRollingDeltaForEstimate(estimate.id, changeOrders)}
                      </span>
                    </span>
                    {selectedProjectId ? (
                      <Link
                        href={`/projects/${selectedProjectId}/estimates?estimate=${estimate.id}`}
                        className={styles.viewerCardLinkBar}
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Estimate →
                      </Link>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
          {selectedViewerEstimate ? (
            <div className={styles.viewerDetail}>
              {viewerChangeOrders.length > 0 ? (
                <>
                  <h4 className={styles.viewerSectionHeading}>Change Orders</h4>
                  <div className={`${styles.viewerRail} ${styles.viewerHistoryRail}`}>
                    {paginatedChangeOrders.map((changeOrder) => {
                      const active = String(changeOrder.id) === selectedChangeOrderId;
                      const lastStatusEvent = lastStatusEventForChangeOrder(changeOrder.id, projectAuditEvents);
                      return (
                        <div
                          key={changeOrder.id}
                          role="button"
                          tabIndex={0}
                          className={`${styles.viewerRailItem} ${styles.viewerHistoryItem} ${viewerHistoryStatusClass(changeOrder.status)} ${
                            active ? `${styles.viewerRailItemActive} ${styles.viewerHistoryItemActive}` : ""
                          }`}
                          onClick={() => onSelectChangeOrder(changeOrder)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectChangeOrder(changeOrder); } }}
                        >
                          <span className={styles.viewerRailTitle}>
                            <span className={styles.viewerRailTitleText}>
                              {changeOrder.title || "Untitled"} · {coLabel(changeOrder)}
                            </span>
                            <span className={styles.viewerHistoryStatusText}>{statusLabel(changeOrder.status, changeOrderStatusLabels)}</span>
                          </span>
                          <span
                            className={`${styles.viewerHistoryMetaText} ${styles.viewerHistoryLineDelta} ${
                              ["approved", "accepted"].includes(changeOrder.status)
                                ? styles.viewerHistoryLineDeltaApproved
                                : ""
                            }`}
                          >
                            Line delta: ${changeOrder.line_total_delta}
                          </span>
                          {lastStatusEvent ? (
                            <span className={styles.viewerHistoryMetaText}>
                              Last action: {statusEventActionLabel(lastStatusEvent, changeOrderStatusLabels)} on{" "}
                              {formatEventDateTime(lastStatusEvent.created_at)} by {eventActorLabel(lastStatusEvent)}
                            </span>
                          ) : (
                            <span className={styles.viewerHistoryMetaText}>No status events yet.</span>
                          )}
                          {changeOrder.public_ref ? (
                            <Link
                              href={publicChangeOrderHref(changeOrder.public_ref)}
                              className={styles.viewerCardLinkBar}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open customer view for ${coLabel(changeOrder)}`}
                              title="Open customer view"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Customer View →
                            </Link>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <PaginationControls page={coPage} totalPages={coTotalPages} totalCount={coTotalCount} onPageChange={setCoPage} />
                  {selectedViewerChangeOrder ? (
                    <>
                      {/* Status & Actions */}
                      <div className={styles.viewerSection}>
                        <button
                          type="button"
                          className={styles.viewerSectionToggle}
                          onClick={() => setIsStatusSectionOpen((v) => !v)}
                          aria-expanded={isStatusSectionOpen}
                        >
                          <h4>Status &amp; Actions</h4>
                          <span className={styles.viewerSectionArrow}>▼</span>
                        </button>
                        {isStatusSectionOpen ? (
                          <div className={styles.viewerSectionContent}>
                            {quickStatusOptions.length > 0 ? (
                              <>
                                <span className={creatorStyles.lifecycleFieldLabel}>Next status</span>
                                <div className={styles.quickStatusPills}>
                                  {quickStatusOptions.map((status) => {
                                    const isSelected = quickStatus === status;
                                    return (
                                      <button
                                        key={status}
                                        type="button"
                                        className={`${styles.quickStatusButton} ${
                                          isSelected
                                            ? `${styles.quickStatusButtonActive} ${quickStatusToneClass(status)}`
                                            : styles.quickStatusButtonInactive
                                        }`}
                                        onClick={() => setQuickStatus(status)}
                                        aria-pressed={isSelected}
                                      >
                                        {quickStatusControlLabel(status, changeOrderStatusLabels, selectedViewerChangeOrder?.status)}
                                      </button>
                                    );
                                  })}
                                </div>
                                {quickStatus === "pending_approval" && !selectedProjectCustomerEmail.trim() ? (
                                  <p className={creatorStyles.actionError}>WARNING: This customer has no email on file and will not receive an automated email.</p>
                                ) : null}
                              </>
                            ) : null}
                            <label className={creatorStyles.lifecycleField}>
                              Status note
                              <textarea
                                className={creatorStyles.statusNote}
                                value={quickStatusNote}
                                onChange={(event) => setQuickStatusNote(event.target.value)}
                                placeholder={quickStatusOptions.length > 0 ? "Optional note for this status action." : "Add a note without changing status."}
                                rows={2}
                              />
                            </label>
                            {actionMessage && actionTone === "success" ? (
                              <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
                            ) : null}
                            {actionMessage && actionTone === "error" ? (
                              <p className={creatorStyles.actionError}>{actionMessage}</p>
                            ) : null}
                            <div className={`${creatorStyles.lifecycleActions} ${styles.viewerStatusActionRow}`}>
                              {quickStatusOptions.length > 0 ? (
                                <button
                                  type="button"
                                  className={`${styles.viewerStatusActionButton} ${styles.viewerStatusActionButtonPrimary}`}
                                  onClick={onQuickUpdateStatus}
                                  disabled={!canMutateChangeOrders || !quickStatusOptions.length || !quickStatus}
                                >
                                  Update CO Status
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className={`${styles.viewerStatusActionButton} ${styles.viewerStatusActionButtonSecondary}`}
                                onClick={onAddChangeOrderStatusNote}
                                disabled={!canMutateChangeOrders || !quickStatusNote.trim()}
                              >
                                Add CO Status Note
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* History section */}
                      <div className={styles.viewerSection}>
                        <button
                          type="button"
                          className={styles.viewerSectionToggle}
                          onClick={() => setIsHistorySectionOpen((v) => !v)}
                          aria-expanded={isHistorySectionOpen}
                        >
                          <h4>History ({selectedChangeOrderStatusEvents.length})</h4>
                          <span className={styles.viewerSectionArrow}>▼</span>
                        </button>
                        {isHistorySectionOpen ? (
                          <div className={styles.viewerSectionContent}>
                            {selectedChangeOrderStatusEvents.length > 0 ? (
                              <>
                                <ul className={styles.viewerEventList}>
                                  {(showAllEvents
                                    ? selectedChangeOrderStatusEvents
                                    : selectedChangeOrderStatusEvents.slice(0, 4)
                                  ).map((event) => (
                                    <li key={event.id} className={styles.viewerEventItem}>
                                      <span className={`${styles.viewerEventAction} ${statusEventActionClass(event)}`}>
                                        {statusEventActionLabel(event, changeOrderStatusLabels)}
                                      </span>
                                      <span className={styles.viewerEventMeta}>
                                        {formatEventDateTime(event.created_at)} by {renderEventActor(event)}
                                      </span>
                                      {event.note ? (
                                        <span className={styles.viewerEventNote}>{event.note}</span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                                {selectedChangeOrderStatusEvents.length > 4 ? (
                                  <button
                                    type="button"
                                    className={styles.showAllToggle}
                                    onClick={() => setShowAllEvents((v) => !v)}
                                  >
                                    {showAllEvents
                                      ? "Show less"
                                      : `Show all ${selectedChangeOrderStatusEvents.length} events`}
                                  </button>
                                ) : null}
                              </>
                            ) : (
                              <p className={styles.viewerHint}>No status events recorded yet.</p>
                            )}
                          </div>
                        ) : null}
                      </div>

                      {/* Line Items section */}
                      <div className={styles.viewerSection}>
                        <button
                          type="button"
                          className={styles.viewerSectionToggle}
                          onClick={() => setIsLineItemsSectionOpen((v) => !v)}
                          aria-expanded={isLineItemsSectionOpen}
                        >
                          <h4>Line Items ({selectedViewerChangeOrder.line_items.length})</h4>
                          <span className={styles.viewerSectionArrow}>▼</span>
                        </button>
                        {isLineItemsSectionOpen ? (
                          <div className={styles.viewerSectionContent}>
                            {selectedViewerChangeOrder.line_items.length > 0 ? (
                                <div className={styles.lineTableWrap}>
                                  <table className={styles.lineTable}>
                                    <thead>
                                      <tr>
                                        <th>Cost code</th>
                                        <th>Description</th>
                                        <th>Adjustment reason</th>
                                        <th>CO line delta ($)</th>
                                        <th>Days delta</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {selectedViewerChangeOrder.line_items.map((line) => (
                                        <tr key={line.id}>
                                          <td data-label="Cost code">{line.cost_code_code || "—"}</td>
                                          <td data-label="Description">{line.description || "—"}</td>
                                          <td data-label="Reason">{line.adjustment_reason || "—"}</td>
                                          <td data-label="CO delta ($)">${line.amount_delta}</td>
                                          <td data-label="Days delta">{line.days_delta}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                            ) : (
                              <p className={styles.viewerHint}>No line items yet on this change order.</p>
                            )}
                            <div className={styles.viewerMetaRow}>
                              <span className={styles.viewerMetaLabel}>Line delta total</span>
                              <strong>${selectedViewerChangeOrder.line_total_delta}</strong>
                            </div>
                            <div className={styles.viewerMetaRow}>
                              <span className={styles.viewerMetaLabel}>Pre-approval total</span>
                              <strong>${selectedViewerWorkingTotals.preApproval}</strong>
                            </div>
                            <div className={styles.viewerMetaRow}>
                              <span className={styles.viewerMetaLabel}>Post-approval total</span>
                              <strong>${selectedViewerWorkingTotals.postApproval}</strong>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <p className={styles.viewerHint}>
                  No change orders have been created yet for this approved origin estimate.
                </p>
              )}
            </div>
          ) : (
            <p>Select an approved estimate to view linked change orders.</p>
          )}
        </div>
      ) : (
        <p className={styles.viewerHint}>No approved estimates yet for this project.</p>
      )) : (
        <p className={styles.viewerHint}>Viewer collapsed. Expand when you need linked estimate/CO context.</p>
      )}
    </section>
  );
}
