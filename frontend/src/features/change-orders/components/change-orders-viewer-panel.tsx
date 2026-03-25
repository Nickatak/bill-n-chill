/**
 * Presentational component for the change-orders viewer panel.
 *
 * Renders the estimate rail, CO list with pagination, action buttons
 * with confirmation, audit event history, line items detail, and
 * contract breakdown. All data and handlers are received via props —
 * no hooks or side effects live here (except the action panel which
 * owns local UI state).
 *
 * Parent: ChangeOrdersConsole
 */

import { useState } from "react";
import Link from "next/link";
import { collapseToggleButtonStyles as collapseButtonStyles } from "@/shared/project-list-viewer";
import { PaginationControls } from "@/shared/components/pagination-controls";
import {
  coLabel,
} from "../helpers";
import {
  statusLabel,
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

function statusEventActionClass(event: AuditEventRecord): string {
  const toStatus = event.to_status || "";
  const fromStatus = event.from_status || "";
  const statusAction = String(event.metadata_json?.status_action || "").toLowerCase();
  if (statusAction === "notate") return styles.coStatusEventNotated;
  if (statusAction === "resend") return styles.coStatusSent;
  if (!fromStatus && toStatus === "draft") return styles.coStatusDraft;
  if (fromStatus === toStatus && (event.note || "").trim()) return styles.coStatusEventNotated;
  if (fromStatus === "sent" && toStatus === "sent") return styles.coStatusSent;
  if (fromStatus === "draft" && toStatus === "sent") return styles.coStatusSent;
  if (toStatus === "approved") return styles.coStatusApproved;
  if (toStatus === "rejected") return styles.coStatusRejected;
  if (toStatus === "void") return styles.coStatusVoid;
  if (toStatus === "draft" && fromStatus) return styles.coStatusDraft;
  return styles.coStatusEventNotated;
}

const coStatusClasses: Record<string, string> = {
  draft: styles.coStatusDraft,
  sent: styles.coStatusSent,
  approved: styles.coStatusApproved,
  rejected: styles.coStatusRejected,
  void: styles.coStatusVoid,
};

function coStatusClass(status: string): string {
  return coStatusClasses[status] ?? "";
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
// Action button helpers
// ---------------------------------------------------------------------------

function coActionButtonColorClass(status: string): string {
  switch (status) {
    case "sent": return styles.actionButtonSent;
    case "approved": return styles.actionButtonApproved;
    case "rejected": return styles.actionButtonRejected;
    case "void": return styles.actionButtonVoid;
    default: return "";
  }
}

function coActionLabel(statusValue: string, currentStatus?: string): string {
  if (statusValue === "sent") {
    return currentStatus === "sent" ? "Re-send" : "Send for Approval";
  }
  if (statusValue === "approved") return "Mark Accepted";
  if (statusValue === "rejected") return "Mark Rejected";
  if (statusValue === "void") return "Void CO";
  return statusValue;
}

function coConfirmationMessage(
  statusValue: string,
  co: ChangeOrderRecord,
  customerName: string,
  currentStatus?: string,
): string {
  const label = coLabel(co);
  const isResend = statusValue === "sent" && currentStatus === "sent";
  if (statusValue === "sent") {
    return `${isResend ? "Re-send" : "Send"} ${label} to ${customerName || "customer"} for approval.`;
  }
  if (statusValue === "approved") return `Mark ${label} as accepted.`;
  if (statusValue === "rejected") return `Mark ${label} as rejected.`;
  if (statusValue === "void") return `Void ${label}.`;
  return `Transition ${label} to ${statusValue}.`;
}

function coEmailNotice(customerEmail: string, customerId?: number | null) {
  if (customerEmail) return `Email notification will be sent to ${customerEmail}.`;
  return (
    <>
      No email on file — customer won&apos;t be notified automatically.{" "}
      {customerId ? <Link href={`/customers?customer=${customerId}`}>Edit customer to add email &rarr;</Link> : null}
    </>
  );
}

/** Action confirmation panel for change orders. */
function ChangeOrderActionPanel({
  selectedViewerChangeOrder,
  quickStatusOptions,
  selectedProjectCustomerEmail,
  selectedProjectCustomerId,
  selectedProjectName,
  quickStatus,
  setQuickStatus,
  quickStatusNote,
  setQuickStatusNote,
  actionMessage,
  actionTone,
  onQuickUpdateStatus,
  onAddChangeOrderStatusNote,
  canMutateChangeOrders,
  changeOrderStatusLabels,
}: {
  selectedViewerChangeOrder: ChangeOrderRecord;
  quickStatusOptions: string[];
  selectedProjectCustomerEmail: string;
  selectedProjectCustomerId: number | null;
  selectedProjectName: string;
  quickStatus: string;
  setQuickStatus: (status: string) => void;
  quickStatusNote: string;
  setQuickStatusNote: (note: string) => void;
  actionMessage: string;
  actionTone: string;
  onQuickUpdateStatus: () => Promise<ChangeOrderRecord | null>;
  onAddChangeOrderStatusNote: () => void;
  canMutateChangeOrders: boolean;
  changeOrderStatusLabels: Record<string, string>;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const customerEmail = (selectedProjectCustomerEmail || "").trim();
  const customerName = selectedProjectName || "";

  function handleActionClick(statusValue: string) {
    setShareMessage("");
    if (pendingAction === statusValue) {
      setPendingAction(null);
      setQuickStatus("");
      return;
    }
    setPendingAction(statusValue);
    setQuickStatus(statusValue);
  }

  async function handleConfirm() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated = await onQuickUpdateStatus();
      if (!updated) return;
      setPendingAction(null);

      if (pendingAction === "sent" && updated.public_ref) {
        const publicUrl = `${window.location.origin}/change-order/${updated.public_ref}`;
        const senderName = (updated.sender_name || "").trim();
        const from = senderName ? ` from ${senderName}` : "";
        const shareText = `Hi ${customerName} — here's a change order${from} for your review:\n${publicUrl}`;

        if (typeof navigator.share === "function") {
          try {
            await navigator.share({ title: coLabel(updated), text: shareText });
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
    setQuickStatus("");
    setQuickStatusNote("");
  }

  const pendingLabel = pendingAction
    ? coActionLabel(pendingAction, selectedViewerChangeOrder.status)
    : "";

  return (
    <div className={styles.viewerSectionContent}>
      {quickStatusOptions.length > 0 ? (
        <div className={styles.actionButtons}>
          {quickStatusOptions.map((status) => {
            const label = coActionLabel(status, selectedViewerChangeOrder.status);
            const isActive = pendingAction === status;
            return (
              <button
                key={status}
                type="button"
                className={`${styles.viewerStatusActionButton} ${coActionButtonColorClass(status)} ${
                  isActive ? styles.actionButtonActive : ""
                }`}
                onClick={() => handleActionClick(status)}
                aria-pressed={isActive}
                disabled={!canMutateChangeOrders}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      {pendingAction ? (
        <div className={styles.actionConfirmPanel}>
          <p className={styles.actionConfirmMessage}>
            {coConfirmationMessage(
              pendingAction,
              selectedViewerChangeOrder,
              customerName,
              selectedViewerChangeOrder.status,
            )}
          </p>
          <label className={creatorStyles.lifecycleField}>
            <span className={creatorStyles.lifecycleFieldLabel}>Note (optional)</span>
            <textarea
              className={creatorStyles.statusNote}
              value={quickStatusNote}
              onChange={(event) => setQuickStatusNote(event.target.value)}
              placeholder="Optional note for this action"
              rows={2}
            />
          </label>
          {pendingAction === "sent" ? (
            <p className={styles.actionConfirmDetail}>
              {coEmailNotice(customerEmail, selectedProjectCustomerId)}
            </p>
          ) : null}
          <div className={styles.actionConfirmActions}>
            <button
              type="button"
              className={styles.viewerStatusActionButton}
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.viewerStatusActionButton} ${coActionButtonColorClass(pendingAction)}`}
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? <span className={styles.sendingDots}>Sending</span> : `Confirm ${pendingLabel}`}
            </button>
          </div>
        </div>
      ) : null}

      {!pendingAction ? (
        <label className={creatorStyles.lifecycleField}>
          <span className={creatorStyles.lifecycleFieldLabel}>Status note</span>
          <textarea
            className={creatorStyles.statusNote}
            value={quickStatusNote}
            onChange={(event) => setQuickStatusNote(event.target.value)}
            placeholder="Add a note without changing status."
            rows={2}
          />
        </label>
      ) : null}

      {actionMessage && actionTone === "success" ? (
        <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
      ) : null}
      {actionMessage && actionTone === "error" ? (
        <p className={creatorStyles.actionError}>{actionMessage}</p>
      ) : null}
      {shareMessage ? (
        <p className={creatorStyles.actionSuccess}>{shareMessage}</p>
      ) : null}

      {!pendingAction ? (
        <div className={`${creatorStyles.lifecycleActions} ${styles.viewerStatusActionRow}`}>
          <button
            type="button"
            className={`${styles.viewerStatusActionButton} ${styles.viewerStatusActionButtonSecondary}`}
            onClick={onAddChangeOrderStatusNote}
            disabled={!canMutateChangeOrders || !quickStatusNote.trim()}
          >
            Add CO Status Note
          </button>
        </div>
      ) : null}
    </div>
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
  selectedProjectCustomerId: number | null;

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

  // Status & actions
  canMutateChangeOrders: boolean;
  quickStatusOptions: string[];
  quickStatus: string;
  setQuickStatus: (status: string) => void;
  quickStatusNote: string;
  setQuickStatusNote: (note: string) => void;
  onQuickUpdateStatus: () => Promise<ChangeOrderRecord | null>;
  onAddChangeOrderStatusNote: () => void;

  // Action feedback
  actionMessage: string;
  actionTone: string;

  // History
  selectedChangeOrderStatusEvents: AuditEventRecord[];

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
  selectedProjectCustomerId,
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
  selectedChangeOrderStatusEvents,
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
                  <div className={styles.coCardList}>
                    {paginatedChangeOrders.map((changeOrder) => {
                      const active = String(changeOrder.id) === selectedChangeOrderId;
                      const lastStatusEvent = lastStatusEventForChangeOrder(changeOrder.id, projectAuditEvents);
                      return (
                        <div
                          key={changeOrder.id}
                          role="button"
                          tabIndex={0}
                          className={`${styles.coCard} ${active ? styles.coCardActive : ""}`}
                          onClick={() => onSelectChangeOrder(changeOrder)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectChangeOrder(changeOrder); } }}
                        >
                          <span className={styles.coCardTitleRow}>
                            <span className={styles.coCardTitle}>
                              {changeOrder.title || "Untitled"} · {coLabel(changeOrder)}
                            </span>
                            <span className={`${styles.coCardStatusBadge} ${coStatusClass(changeOrder.status)}`}>
                              {statusLabel(changeOrder.status, changeOrderStatusLabels)}
                            </span>
                          </span>
                          <span className={styles.coCardMeta}>
                            ${changeOrder.line_total_delta} · {coLabel(changeOrder)}
                          </span>
                          <span className={styles.coCardDate}>
                            {lastStatusEvent
                              ? `Last action: ${formatEventDateTime(lastStatusEvent.created_at)}`
                              : `Created: ${formatEventDateTime(changeOrder.created_at)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <PaginationControls page={coPage} totalPages={coTotalPages} totalCount={coTotalCount} onPageChange={setCoPage} />
                  {selectedViewerChangeOrder ? (
                    <>
                      <ChangeOrderActionPanel
                        selectedViewerChangeOrder={selectedViewerChangeOrder}
                        quickStatusOptions={quickStatusOptions}
                        selectedProjectCustomerEmail={selectedProjectCustomerEmail}
                        selectedProjectCustomerId={selectedProjectCustomerId}
                        selectedProjectName={selectedProjectName}
                        quickStatus={quickStatus}
                        setQuickStatus={setQuickStatus}
                        quickStatusNote={quickStatusNote}
                        setQuickStatusNote={setQuickStatusNote}
                        actionMessage={actionMessage}
                        actionTone={actionTone}
                        onQuickUpdateStatus={onQuickUpdateStatus}
                        onAddChangeOrderStatusNote={onAddChangeOrderStatusNote}
                        canMutateChangeOrders={canMutateChangeOrders}
                        changeOrderStatusLabels={changeOrderStatusLabels}
                      />

                      {selectedChangeOrderStatusEvents.length > 0 ? (
                        <div className={styles.statusEvents}>
                          <h4>Status Events</h4>
                          <div className={styles.statusEventsTableWrap}>
                            <table className={styles.statusEventsTable}>
                              <thead>
                                <tr>
                                  <th>Action</th>
                                  <th>Occurred</th>
                                  <th>Note</th>
                                  <th>Who</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedChangeOrderStatusEvents.map((event) => {
                                  const actionClass = statusEventActionClass(event);
                                  return (
                                    <tr key={event.id}>
                                      <td data-label="Action">
                                        <span className={`${styles.coEventBadge} ${actionClass}`}>
                                          {statusEventActionLabel(event, changeOrderStatusLabels)}
                                        </span>
                                      </td>
                                      <td data-label="Occurred">{formatEventDateTime(event.created_at)}</td>
                                      <td data-label="Note">{event.note || "—"}</td>
                                      <td data-label="Who">{renderEventActor(event)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
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
