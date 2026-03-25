/**
 * Presentational component for the estimates viewer panel.
 *
 * Renders the lifecycle section: status filter pills, family-grouped estimate
 * tree, action buttons with confirmation, and status event history. All data
 * and handlers are received via props — no hooks or side effects live here
 * (except the action confirmation panel which owns local UI state).
 *
 * Parent: EstimatesConsole
 */

import { useState } from "react";
import Link from "next/link";
import { formatDateTimeDisplay } from "@/shared/date-format";
import { formatDecimal } from "@/shared/money-format";
import { collapseToggleButtonStyles as collapseButtonStyles } from "@/shared/project-list-viewer";
import { formatStatusAction, isNotatedStatusEvent, isResendStatusEvent } from "../helpers";
import type { EstimateRecord, EstimateStatusEventRecord, ProjectRecord } from "../types";
import styles from "./estimates-console.module.css";

// ---------------------------------------------------------------------------
// Pure display helpers (no component state dependency)
// ---------------------------------------------------------------------------

/** Parse a numeric string, returning 0 for non-finite values. */
function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Format a date string for display, falling back to the raw value. */
function formatEventDate(dateValue: string): string {
  return formatDateTimeDisplay(dateValue, dateValue);
}

/** Format the "last action" date for an estimate row. */
function formatEstimateLastActionDate(estimate: EstimateRecord): string {
  return formatEventDate(estimate.updated_at || estimate.created_at);
}

// ---------------------------------------------------------------------------
// Status → CSS class mapping (depends only on the CSS module)
// ---------------------------------------------------------------------------

const statusClasses: Record<string, string> = {
  draft: styles.statusDraft,
  sent: styles.statusSent,
  approved: styles.statusApproved,
  rejected: styles.statusRejected,
  void: styles.statusArchived,
  archived: styles.statusArchived,
};

// ---------------------------------------------------------------------------
// Action button definitions
// ---------------------------------------------------------------------------

/** Map a status value to its action button color class. */
function actionButtonColorClass(statusValue: string): string {
  switch (statusValue) {
    case "sent": return styles.actionButtonSent;
    case "approved": return styles.actionButtonApproved;
    case "rejected": return styles.actionButtonRejected;
    case "void": return styles.actionButtonVoid;
    default: return "";
  }
}

/** Map a status transition to a user-facing action label. */
function actionLabel(statusValue: string, optionLabel: string): string {
  switch (statusValue) {
    case "sent": return optionLabel === "Re-send" ? "Re-send" : "Send to Customer";
    case "approved": return "Mark Approved";
    case "rejected": return "Mark Rejected";
    case "void": return "Void Estimate";
    default: return optionLabel;
  }
}

/** Build the confirmation message for an action. */
function actionConfirmationMessage(
  statusValue: string,
  optionLabel: string,
  estimate: EstimateRecord,
  customerName: string,
  customerEmail: string,
): string {
  const docLabel = `estimate #${estimate.id} v${estimate.version}`;
  const isResend = optionLabel === "Re-send";
  if (statusValue === "sent") {
    const verb = isResend ? "Re-send" : "Send";
    return `${verb} ${docLabel} to ${customerName || "customer"}.`;
  }
  if (statusValue === "approved") return `Mark ${docLabel} as approved.`;
  if (statusValue === "rejected") return `Mark ${docLabel} as rejected.`;
  if (statusValue === "void") return `Void ${docLabel}.`;
  return `Transition ${docLabel} to ${optionLabel.toLowerCase()}.`;
}

/** Build the email notice for send/re-send actions. */
function emailNotice(customerEmail: string, customerId?: number) {
  if (customerEmail) return `Email notification will be sent to ${customerEmail}.`;
  return (
    <>
      No email on file — customer won&apos;t be notified automatically.{" "}
      {customerId ? <Link href={`/customers?customer=${customerId}`}>Edit customer to add email &rarr;</Link> : null}
    </>
  );
}

/** Action confirmation panel — owns its own expanded/collapsed state. */
function EstimateActionPanel({
  selectedEstimate,
  nextStatusOptions,
  selectedProject,
  selectedStatus,
  setSelectedStatus,
  statusNote,
  setStatusNote,
  actionMessage,
  actionTone,
  handleUpdateEstimateStatus,
  handleAddEstimateStatusNote,
  canSubmitStatusNote,
}: {
  selectedEstimate: EstimateRecord;
  nextStatusOptions: Array<{ value: string; label: string }>;
  selectedProject: ProjectRecord | null;
  selectedStatus: string;
  setSelectedStatus: (status: string) => void;
  statusNote: string;
  setStatusNote: (note: string) => void;
  actionMessage: string;
  actionTone: string;
  handleUpdateEstimateStatus: () => Promise<EstimateRecord | null>;
  handleAddEstimateStatusNote: () => void;
  canSubmitStatusNote: boolean;
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
    const updated = await handleUpdateEstimateStatus();
    if (!updated) return; // failed — error message shown by handler
    setPendingAction(null);

    // Trigger share mechanism for send/re-send actions
    if (pendingAction === "sent" && updated.public_ref) {
      const publicUrl = `${window.location.origin}/estimate/${updated.public_ref}`;
      const senderName = (updated.sender_name || "").trim();
      const greeting = customerName ? `Hi ${customerName} — ` : "";
      const from = senderName ? ` from ${senderName}` : "";
      const shareText = `${greeting}here's your estimate${from}:\n${publicUrl}`;

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: `Estimate #${updated.id}`, text: shareText });
        } catch {
          // User cancelled share sheet — not an error
        }
      } else {
        try {
          await navigator.clipboard.writeText(publicUrl);
          setShareMessage("Link copied to clipboard.");
        } catch {
          // Clipboard API not available
        }
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

  const pendingOption = nextStatusOptions.find((o) => o.value === pendingAction);

  return (
    <div className={styles.lifecycleGrid}>
      {nextStatusOptions.length > 0 ? (
        <div className={styles.actionButtons}>
          {nextStatusOptions.map((option) => {
            const label = actionLabel(option.value, option.label);
            const isActive = pendingAction === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`${styles.lifecycleActionButton} ${actionButtonColorClass(option.value)} ${
                  isActive ? styles.lifecycleActionButtonActive : ""
                }`}
                onClick={() => handleActionClick(option.value)}
                aria-pressed={isActive}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      {nextStatusOptions.length === 0 && selectedEstimate.status === "approved" && selectedProject ? (
        <div className={styles.actionButtons}>
          <Link
            href={`/projects/${selectedProject.id}/change-orders?origin_estimate=${selectedEstimate.id}`}
            className={`${styles.lifecycleActionButton} ${styles.actionButtonApproved}`}
            style={{ flex: "1 1 100%", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            View Change Orders
          </Link>
        </div>
      ) : null}

      {pendingAction && pendingOption ? (
        <div className={styles.actionConfirmPanel}>
          <p className={styles.actionConfirmMessage}>
            {actionConfirmationMessage(
              pendingAction,
              pendingOption.label,
              selectedEstimate,
              customerName,
              customerEmail,
            )}
          </p>
          <label className={styles.lifecycleField}>
            <span className={styles.lifecycleFieldLabel}>Note (optional)</span>
            <textarea
              className={styles.statusNote}
              value={statusNote}
              onChange={(event) => setStatusNote(event.target.value)}
              placeholder="Optional note for this action"
              rows={2}
            />
          </label>
          {(pendingAction === "sent") ? (
            <p className={styles.actionConfirmDetail}>
              {emailNotice(customerEmail, selectedProject?.customer)}
            </p>
          ) : null}
          <div className={styles.actionConfirmActions}>
            <button
              type="button"
              className={styles.lifecycleActionButton}
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${styles.lifecycleActionButton} ${actionButtonColorClass(pendingAction)}`}
              onClick={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? <span className={styles.sendingDots}>Sending</span> : `Confirm ${actionLabel(pendingAction, pendingOption.label)}`}
            </button>
          </div>
        </div>
      ) : null}

      {!pendingAction ? (
        <label className={styles.lifecycleField}>
          <span className={styles.lifecycleFieldLabel}>Status note</span>
          <textarea
            className={styles.statusNote}
            value={statusNote}
            onChange={(event) => setStatusNote(event.target.value)}
            placeholder="Add note for this estimate"
            rows={3}
          />
        </label>
      ) : null}

      {actionMessage && actionTone === "success" ? (
        <p className={styles.actionSuccess}>{actionMessage}</p>
      ) : null}
      {actionMessage && actionTone === "error" ? (
        <p className={styles.actionError}>{actionMessage}</p>
      ) : null}
      {shareMessage ? (
        <p className={styles.actionSuccess}>{shareMessage}</p>
      ) : null}

      {!pendingAction ? (
        <div className={styles.lifecycleActions}>
          <button
            type="button"
            className={styles.lifecycleActionButton}
            onClick={handleAddEstimateStatusNote}
            disabled={!canSubmitStatusNote}
          >
            Add Estimate Status Note
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EstimateFamily = {
  title: string;
  items: EstimateRecord[];
};

export type EstimatesViewerPanelProps = {
  selectedProject: ProjectRecord | null;
  isMobile: boolean;
  isViewerExpanded: boolean;
  setIsViewerExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  // Filter pills
  viewerStatusOptions: Array<{ value: string; label: string }>;
  estimateStatusFilters: string[];
  toggleEstimateStatusFilter: (value: string) => void;
  estimateStatusCounts: Record<string, number>;
  setEstimateStatusFilters: (filters: string[]) => void;
  estimateStatusFilterValues: string[];
  defaultEstimateStatusFilters: string[];

  // Family tree
  visibleEstimateFamilies: EstimateFamily[];
  estimateFamiliesLength: number;
  selectedEstimateId: string;
  openFamilyHistory: Set<string>;
  handleSelectFamilyLatest: (title: string, latest: EstimateRecord) => void;
  handleSelectEstimate: (estimate: EstimateRecord) => void;
  handleFamilyCardQuickAction: (estimate: EstimateRecord) => void;
  selectedProjectId: string;

  // Display callbacks (depend on parent-derived data)
  formatEstimateStatus: (status?: string) => string;
  quickActionKindForStatus: (status: string) => "change_order" | "revision" | null;
  quickActionTitleForStatus: (status: string) => string;

  // Status lifecycle (only relevant when an estimate is selected)
  selectedEstimate: EstimateRecord | null;
  nextStatusOptions: Array<{ value: string; label: string }>;
  selectedStatus: string;
  setSelectedStatus: (status: string) => void;
  statusNote: string;
  setStatusNote: (note: string) => void;
  actionMessage: string;
  actionTone: string;
  canSubmitStatusNote: boolean;
  handleUpdateEstimateStatus: () => Promise<EstimateRecord | null>;
  handleAddEstimateStatusNote: () => void;
  statusEvents: EstimateStatusEventRecord[];
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EstimatesViewerPanel({
  selectedProject,
  isMobile,
  isViewerExpanded,
  setIsViewerExpanded,
  viewerStatusOptions,
  estimateStatusFilters,
  toggleEstimateStatusFilter,
  estimateStatusCounts,
  setEstimateStatusFilters,
  estimateStatusFilterValues,
  defaultEstimateStatusFilters,
  visibleEstimateFamilies,
  estimateFamiliesLength,
  selectedEstimateId,
  openFamilyHistory,
  handleSelectFamilyLatest,
  handleSelectEstimate,
  handleFamilyCardQuickAction,
  selectedProjectId,
  formatEstimateStatus,
  quickActionKindForStatus,
  quickActionTitleForStatus,
  selectedEstimate,
  nextStatusOptions,
  selectedStatus,
  setSelectedStatus,
  statusNote,
  setStatusNote,
  actionMessage,
  actionTone,
  canSubmitStatusNote,
  handleUpdateEstimateStatus,
  handleAddEstimateStatusNote,
  statusEvents,
}: EstimatesViewerPanelProps) {
  return (
    <section className={styles.lifecycle}>
      <div className={styles.lifecycleHeader}>
        <h3>
          {selectedProject
            ? `Estimates for: ${selectedProject.name}`
            : "Estimates"}
        </h3>
        {!isMobile ? (
          <button
            type="button"
            className={collapseButtonStyles.collapseButton}
            onClick={() => setIsViewerExpanded((current) => !current)}
            aria-expanded={isViewerExpanded}
          >
            {isViewerExpanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
      </div>

      {(isMobile || isViewerExpanded) ? (
        <>
          <div className={styles.versionFilters}>
            <span className={styles.versionFiltersLabel}>Estimate status filter</span>
            <div className={styles.versionFilterButtons}>
              {viewerStatusOptions.map((option) => {
                const active = estimateStatusFilters.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.statusPill} ${
                      active ? statusClasses[option.value] : styles.statusPillInactive
                    } ${active ? styles.statusPillActive : ""}`}
                    aria-pressed={active}
                    onClick={() => toggleEstimateStatusFilter(option.value)}
                  >
                    <span>{option.label}</span>
                    <span className={styles.statusPillCount}>{estimateStatusCounts[option.value] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.versionFilterActions}>
              <button
                type="button"
                className={styles.versionFilterActionButton}
                onClick={() => setEstimateStatusFilters(estimateStatusFilterValues)}
              >
                Show All Statuses
              </button>
              <button
                type="button"
                className={styles.versionFilterActionButton}
                onClick={() => setEstimateStatusFilters(defaultEstimateStatusFilters)}
              >
                Reset Filters
              </button>
            </div>
          </div>

          <div className={styles.versionTree}>
            {visibleEstimateFamilies.length > 0 ? (
              visibleEstimateFamilies.map((family) => {
                const latest = family.items[family.items.length - 1];
                const history = family.items.slice(0, -1).reverse();
                const selectedInFamily = family.items.find(
                  (estimate) => String(estimate.id) === selectedEstimateId,
                );
                const isFamilyActive = Boolean(selectedInFamily);
                const isViewingHistory =
                  selectedInFamily && String(selectedInFamily.id) !== String(latest.id);
                const isLatestSelected = String(latest.id) === selectedEstimateId;
                const isHistoryOpen = openFamilyHistory.has(family.title);
                const quickActionKind = quickActionKindForStatus(latest.status);
                const quickActionTitle = quickActionTitleForStatus(latest.status);
                const latestTotal = formatDecimal(toNumber(latest.grand_total || "0"));
                return (
                  <div
                    key={family.title}
                    data-family-title={family.title}
                    className={`${styles.familyGroup} ${
                      isFamilyActive ? styles.familyGroupActive : ""
                    }`}
                  >
                    <div className={styles.familyRow}>
                      <div className={styles.familyMainColumn}>
                        <div
                          role="button"
                          tabIndex={0}
                          className={`${styles.familyMain} ${
                            isLatestSelected ? styles.familyMainActive : ""
                          }`}
                          onClick={() => handleSelectFamilyLatest(family.title, latest)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectFamilyLatest(family.title, latest); } }}
                        >
                          <div className={styles.familyMainContent}>
                            <span className={styles.familyTitleRow}>
                              <span className={styles.familyTitle}>{family.title}</span>
                              <span
                                className={`${styles.versionStatus} ${
                                  statusClasses[latest.status] ?? ""
                                }`}
                              >
                                {formatEstimateStatus(latest.status)}
                              </span>
                            </span>
                            <span className={styles.familyMeta}>
                              ${latestTotal} · Estimate #{latest.id} · {history.length} history{" "}
                              {history.length === 1 ? "entry" : "entries"}
                            </span>
                            <span className={styles.familyDate}>
                              Last action: {formatEstimateLastActionDate(latest)}
                            </span>
                          </div>
                        </div>
                        {isViewingHistory || quickActionKind === "revision" ? (
                          <div className={styles.familyFooter}>
                            {isViewingHistory ? (
                              <span className={styles.historyNotice}>
                                Viewing v{selectedInFamily?.version}
                              </span>
                            ) : null}
                            {quickActionKind === "revision" ? (
                              <button
                                type="button"
                                className={styles.familyActionButton}
                                aria-label={`${quickActionTitle} (estimate #${latest.id})`}
                                title={quickActionTitle}
                                onClick={() => void handleFamilyCardQuickAction(latest)}
                              >
                                New Revision
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {isHistoryOpen && history.length > 0 ? (
                        <div className={styles.historyRow}>
                          {history.map((estimate) => {
                              const total = formatDecimal(toNumber(estimate.grand_total || "0"));
                              const isSelected = String(estimate.id) === selectedEstimateId;
                              return (
                                <div key={estimate.id} className={styles.historyCardColumn}>
                                  <button
                                    type="button"
                                    className={`${styles.historyCard} ${
                                      isSelected ? styles.historyCardActive : ""
                                    }`}
                                    onClick={() => handleSelectEstimate(estimate)}
                                  >
                                    <span className={styles.historyMetaRow}>
                                      <span className={styles.historyVersionMeta}>
                                        v{estimate.version} <span className={styles.historyMeta}>#{estimate.id}</span>
                                      </span>
                                      <span
                                        className={`${styles.versionStatus} ${
                                          statusClasses[estimate.status] ?? ""
                                        } ${styles.historyStatus}`}
                                      >
                                        {formatEstimateStatus(estimate.status)}
                                      </span>
                                    </span>
                                    <span className={styles.historyAmount}>${total}</span>
                                    <span className={styles.historyDate}>
                                      {formatEstimateLastActionDate(estimate)}
                                    </span>
                                  </button>
                                </div>
                              );
                            })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            ) : estimateFamiliesLength > 0 ? (
              <p className={styles.inlineHint}>No estimate families match the selected status filters.</p>
            ) : (
              <p className={styles.inlineHint}>No estimates yet. Use the workspace above to create one.</p>
            )}
          </div>

          {selectedEstimateId && selectedEstimate ? (
            <EstimateActionPanel
              selectedEstimate={selectedEstimate}
              nextStatusOptions={nextStatusOptions}
              selectedProject={selectedProject}
              selectedStatus={selectedStatus}
              setSelectedStatus={setSelectedStatus}
              statusNote={statusNote}
              setStatusNote={setStatusNote}
              actionMessage={actionMessage}
              actionTone={actionTone}
              handleUpdateEstimateStatus={handleUpdateEstimateStatus}
              handleAddEstimateStatusNote={handleAddEstimateStatusNote}
              canSubmitStatusNote={canSubmitStatusNote}
            />
          ) : null}

          {selectedEstimateId && statusEvents.length > 0 ? (
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
                    {statusEvents.map((event) => {
                      const toStatusClass = isResendStatusEvent(event)
                        ? statusClasses["sent"] ?? ""
                        : isNotatedStatusEvent(event)
                          ? styles.statusNotated
                          : statusClasses[event.to_status] ?? "";
                      return (
                        <tr key={event.id}>
                          <td data-label="Action">
                            <span className={`${styles.versionStatus} ${toStatusClass}`}>
                              {formatStatusAction(event)}
                            </span>
                          </td>
                          <td data-label="Occurred">{formatEventDate(event.changed_at)}</td>
                          <td data-label="Note">{event.note || "—"}</td>
                          <td data-label="Who">
                            {event.changed_by_customer_id ? (
                              <Link
                                href={`/customers?customer=${event.changed_by_customer_id}`}
                                className={styles.statusEventActorLink}
                              >
                                {event.changed_by_display || `Customer #${event.changed_by_customer_id}`}
                              </Link>
                            ) : (
                              event.changed_by_display || event.changed_by_email || "Unknown user"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.inlineHint}>Viewer collapsed. Expand to review versions, status transitions, and history.</p>
      )}
    </section>
  );
}
