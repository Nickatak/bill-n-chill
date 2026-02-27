"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicDocumentViewerShell } from "@/shared/document-viewer/public-document-viewer-shell";
import {
  PublicDocumentFrame,
  publicDocumentFrameStyles as frameStyles,
  publicDocumentViewerClassNames,
} from "@/shared/document-viewer/public-document-frame";
import {
  resolveDefaultTerms,
  resolvePublicRecipient,
  resolvePublicSender,
} from "@/shared/document-viewer/public-document-context";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { ApiResponse, ChangeOrderRecord } from "../types";
import styles from "./change-order-public-preview.module.css";

type ChangeOrderPublicPreviewProps = {
  publicToken: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
};

function statusLabel(status?: string): string {
  const value = (status || "").trim();
  return STATUS_LABELS[value] || value || "Unknown";
}

function parseAmount(value?: string): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value?: string): string {
  return parseAmount(value).toFixed(2);
}

function formatDisplayDateTime(value?: string): string {
  if (!value) {
    return "Unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function publicEstimateHref(publicRef?: string): string {
  if (!publicRef) {
    return "";
  }
  return `/estimate/${publicRef}`;
}

export function ChangeOrderPublicPreview({ publicToken }: ChangeOrderPublicPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading change order...");
  const [changeOrder, setChangeOrder] = useState<ChangeOrderRecord | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciderName, setDeciderName] = useState("");
  const [deciderEmail, setDeciderEmail] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionReceiptName, setDecisionReceiptName] = useState("");
  const [justSubmittedDecision, setJustSubmittedDecision] = useState<"approve" | "reject" | null>(null);
  const [printTimestamp, setPrintTimestamp] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canDecide = changeOrder?.status === "pending_approval";
  const showDecisionSection = canDecide;
  const decisionStatusLabel = statusLabel(changeOrder?.status);
  const nonPendingDecisionMessage =
    changeOrder?.status === "approved"
      ? decisionReceiptName.trim()
        ? `Decision status: ${decisionStatusLabel}. Thank you for your approval, ${decisionReceiptName.trim()}.`
        : `Decision status: ${decisionStatusLabel}.`
      : `Decision status: ${decisionStatusLabel}. This change order is not awaiting response.`;
  const decisionFeedbackMessage = useMemo(() => {
    if (!justSubmittedDecision) {
      return null;
    }
    if (justSubmittedDecision === "approve") {
      return decisionReceiptName.trim()
        ? `Decision received: Approved. Thank you, ${decisionReceiptName.trim()}. Your response has been recorded.`
        : "Decision received: Approved. Your response has been recorded.";
    }
    return "Decision received: Rejected. Your response has been recorded.";
  }, [decisionReceiptName, justSubmittedDecision]);
  const settledBannerClassName =
    justSubmittedDecision === "approve"
      ? `${styles.decisionBannerSettled} ${styles.decisionBannerRecentlyApproved}`
      : justSubmittedDecision === "reject"
        ? `${styles.decisionBannerSettled} ${styles.decisionBannerRecentlyRejected}`
        : styles.decisionBannerSettled;
  const sender = useMemo(
    () => resolvePublicSender(changeOrder?.organization_context),
    [changeOrder?.organization_context],
  );
  const recipient = useMemo(
    () => resolvePublicRecipient(changeOrder?.project_context),
    [changeOrder?.project_context],
  );
  const termsText = useMemo(() => {
    const organizationTerms = resolveDefaultTerms(changeOrder?.organization_context, "estimate");
    return organizationTerms || "No terms specified.";
  }, [changeOrder?.organization_context]);
  const reasonFallback = useMemo(() => {
    const organizationReason = resolveDefaultTerms(changeOrder?.organization_context, "change_order");
    return organizationReason || "No reason provided.";
  }, [changeOrder?.organization_context]);

  useEffect(() => {
    if (!canDecide) {
      setDecisionMessage("");
    }
  }, [canDecide]);

  useEffect(() => {
    if (!justSubmittedDecision) {
      return;
    }
    const timer = window.setTimeout(() => {
      setJustSubmittedDecision(null);
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [justSubmittedDecision]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const titleBeforeMount = document.title;
    const formatPrintedAt = () =>
      new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        day: "numeric",
        year: "2-digit",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date());

    const setPrintContext = () => {
      setPrintTimestamp(formatPrintedAt());
    };

    const handleBeforePrint = () => {
      setPrintContext();
      document.title = "";
    };

    const handleAfterPrint = () => {
      document.title = titleBeforeMount;
    };

    setPrintContext();
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      document.title = titleBeforeMount;
    };
  }, []);

  useEffect(() => {
    async function loadChangeOrder() {
      try {
        const response = await fetch(`${normalizedBaseUrl}/public/change-orders/${publicToken}/`);
        const payload: ApiResponse = await response.json();
        if (!response.ok || !payload.data || Array.isArray(payload.data)) {
          setStatusMessage(payload.error?.message || "Change order not found.");
          return;
        }
        setChangeOrder(payload.data as ChangeOrderRecord);
        setDecisionReceiptName("");
        setJustSubmittedDecision(null);
        setStatusMessage("");
      } catch {
        setStatusMessage("Could not reach change-order endpoint.");
      }
    }

    void loadChangeOrder();
  }, [normalizedBaseUrl, publicToken]);

  async function applyDecision(decision: "approve" | "reject") {
    if (!changeOrder || !canDecide || decisionSubmitting) {
      return;
    }
    setDecisionSubmitting(true);
    setDecisionMessage("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/public/change-orders/${publicToken}/decision/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            note: decisionNote,
            decider_name: deciderName,
            decider_email: deciderEmail,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        setDecisionMessage(payload.error?.message || "Could not apply decision.");
        return;
      }
      setChangeOrder(payload.data as ChangeOrderRecord);
      setDecisionReceiptName(deciderName.trim());
      setJustSubmittedDecision(decision);
      setDecisionMessage("");
    } catch {
      setDecisionMessage("Could not reach change-order decision endpoint.");
    } finally {
      setDecisionSubmitting(false);
    }
  }

  return (
    <PublicDocumentViewerShell
      classNames={publicDocumentViewerClassNames()}
      statusMessage={statusMessage}
      banner={
        changeOrder
          ? {
              tone: canDecide ? "pending" : "complete",
              eyebrow: "Decision",
              text: canDecide
                ? "Ready to sign? Jump to the decision section and submit your response."
                : decisionFeedbackMessage ?? nonPendingDecisionMessage,
              linkHref: canDecide ? "#change-order-decision" : undefined,
              linkLabel: canDecide ? "Review & Sign" : undefined,
              stateClassName: canDecide ? styles.decisionBannerAwaiting : settledBannerClassName,
            }
          : undefined
      }
    >
      {changeOrder ? (
        <>
          <PublicDocumentFrame
            headerLeft={
              <>
                <section className={frameStyles.partyBlock}>
                  <p className={frameStyles.partyLabel}>From</p>
                  <p className={frameStyles.partyPrimary}>{sender.senderName || sender.companyName}</p>
                  {sender.senderEmail ? (
                    <p className={frameStyles.partySecondary}>{sender.senderEmail}</p>
                  ) : null}
                  {sender.senderAddressLines.length ? (
                    sender.senderAddressLines.map((line, index) => (
                      <p key={`sender-${line}-${index}`} className={frameStyles.partySecondary}>
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className={frameStyles.partySecondary}>Set sender address in Organization settings.</p>
                  )}
                </section>
                <section className={frameStyles.partyBlock}>
                  <p className={frameStyles.partyLabel}>To</p>
                  <p className={frameStyles.partyPrimary}>{recipient.name}</p>
                  {recipient.email ? (
                    <p className={frameStyles.partySecondary}>{recipient.email}</p>
                  ) : null}
                  {recipient.phone ? (
                    <p className={frameStyles.partySecondary}>{recipient.phone}</p>
                  ) : null}
                  {recipient.addressLines.length ? (
                    recipient.addressLines.map((line, index) => (
                      <p key={`${line}-${index}`} className={frameStyles.partySecondary}>
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className={frameStyles.partySecondary}>Billing address unavailable.</p>
                  )}
                </section>
              </>
            }
            headerRight={
              <>
                <div className={frameStyles.logoBox}>
                  {sender.logoUrl ? (
                    <img
                      className={frameStyles.logoImage}
                      src={sender.logoUrl}
                      alt={`${sender.companyName} logo`}
                    />
                  ) : (
                    <p className={frameStyles.logoPlaceholder}>No logo URL set</p>
                  )}
                </div>
                <div>
                  <p className={frameStyles.identityEyebrow}>Change Order</p>
                  <h2 className={frameStyles.identityTitle}>{changeOrder.title || "Untitled Change Order"}</h2>
                  <p className={frameStyles.identitySubhead}>
                    {(changeOrder.project_context?.name || "Project") +
                      ` · CO-${changeOrder.family_key} v${changeOrder.revision_number}`}
                  </p>
                </div>
                <div className={frameStyles.identityMetaRow}>
                  {changeOrder.origin_estimate_context?.public_ref ? (
                    <a
                      className={frameStyles.metaLink}
                      href={publicEstimateHref(changeOrder.origin_estimate_context.public_ref)}
                    >
                      View Related Estimate
                    </a>
                  ) : null}
                </div>
                <hr className={frameStyles.identityDivider} />
                <section className={`${frameStyles.metaDetails} ${styles.detailsPanel}`}>
                  <h4 className={frameStyles.metaDetailsTitle}>Change Order Details</h4>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>CO #</span>
                    <span>CO-{changeOrder.family_key}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Version</span>
                    <span>v{changeOrder.revision_number}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Status</span>
                    <span>{decisionStatusLabel}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Updated</span>
                    <span>{formatDisplayDateTime(changeOrder.updated_at)}</span>
                  </div>
                </section>
              </>
            }
            lineTitle="Line Items"
            columns={["Budget Line", "Description", "Amount Delta", "Days Delta"]}
            rows={(changeOrder.line_items ?? []).map((line) => ({
              key: line.id,
              cells: [
                `#${line.budget_line} ${line.budget_line_cost_code}`,
                line.description || line.budget_line_description,
                `$${formatMoney(line.amount_delta)}`,
                line.days_delta,
              ],
            }))}
            afterLineSection={
              <>
                <div className={frameStyles.panelGrid}>
                  <section className={styles.reasonPanel}>
                    <h4 className={`${frameStyles.panelTitle} ${styles.reasonTitle}`}>Reason</h4>
                    <p className={styles.reasonBody}>{changeOrder.reason || reasonFallback}</p>
                  </section>
                  <section className={frameStyles.panelCard}>
                    <h4 className={frameStyles.panelTitle}>Totals</h4>
                    <div className={styles.totalRow}>
                      <span>Line delta</span>
                      <strong>${formatMoney(changeOrder.amount_delta)}</strong>
                    </div>
                    <div className={styles.totalRow}>
                      <span>Schedule delta</span>
                      <strong>{changeOrder.days_delta} day(s)</strong>
                    </div>
                  </section>
                </div>
                <div className={frameStyles.terms}>
                  <h4>Terms and Conditions</h4>
                  {termsText
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, index) => (
                      <p key={`co-terms-${line}-${index}`}>{line}</p>
                    ))}
                </div>
              </>
            }
            footer={
              <footer>
                <div className={frameStyles.footerRow}>
                  <span>{sender.companyName}</span>
                  <span>{sender.helpEmail || "Help email not set"}</span>
                  <span>{changeOrder.public_ref || publicToken}</span>
                </div>
                <div className={frameStyles.printFooter}>
                  <span>{printTimestamp}</span>
                  <span>{changeOrder.public_ref || publicToken}</span>
                </div>
              </footer>
            }
          />

          {showDecisionSection ? (
            <section id="change-order-decision" className={`${styles.decisionCard} ${styles.publicDecisionSection}`}>
              <h3>Decision</h3>
              {decisionMessage ? <p className={styles.decisionMessage}>{decisionMessage}</p> : null}
              <label className={styles.field}>
                Your name (optional)
                <input
                  value={deciderName}
                  onChange={(event) => setDeciderName(event.target.value)}
                  placeholder="Homeowner name"
                  disabled={decisionSubmitting}
                />
              </label>
              <label className={styles.field}>
                Your email (optional)
                <input
                  value={deciderEmail}
                  onChange={(event) => setDeciderEmail(event.target.value)}
                  placeholder="owner@example.com"
                  disabled={decisionSubmitting}
                />
              </label>
              <label className={styles.field}>
                Note (optional)
                <textarea
                  value={decisionNote}
                  onChange={(event) => setDecisionNote(event.target.value)}
                  rows={3}
                  placeholder="Optional decision note."
                  disabled={decisionSubmitting}
                />
              </label>
              <div className={styles.decisionActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void applyDecision("approve")}
                  disabled={decisionSubmitting}
                >
                  Approve Change Order
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void applyDecision("reject")}
                  disabled={decisionSubmitting}
                >
                  Reject Change Order
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </PublicDocumentViewerShell>
  );
}
