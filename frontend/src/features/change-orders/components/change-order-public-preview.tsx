"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateDisplay } from "@/shared/date-format";
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

function statusClass(status?: string): string {
  if (status === "pending_approval") {
    return styles.statusPending;
  }
  if (status === "approved") {
    return styles.statusApproved;
  }
  if (status === "rejected") {
    return styles.statusRejected;
  }
  if (status === "void") {
    return styles.statusVoid;
  }
  return styles.statusDraft;
}

function parseAmount(value?: string): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value?: string): string {
  return parseAmount(value).toFixed(2);
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

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canDecide = changeOrder?.status === "pending_approval";
  const showDecisionSection = canDecide;
  const decisionStatusLabel = statusLabel(changeOrder?.status);
  const approvalAcknowledgement = useMemo(() => {
    const name = decisionReceiptName.trim();
    if (name) {
      return `Thank you for your approval, ${name}.`;
    }
    return "Thank you for your approval.";
  }, [decisionReceiptName]);
  const nonPendingDecisionMessage =
    changeOrder?.status === "approved"
      ? `Decision status: ${decisionStatusLabel}. ${approvalAcknowledgement}`
      : `Decision status: ${decisionStatusLabel}. This change order is not awaiting response.`;

  useEffect(() => {
    if (!canDecide) {
      setDecisionMessage("");
    }
  }, [canDecide]);

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
      setDecisionMessage("");
    } catch {
      setDecisionMessage("Could not reach change-order decision endpoint.");
    } finally {
      setDecisionSubmitting(false);
    }
  }

  return (
    <section className={styles.preview}>
      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

      {changeOrder ? (
        <>
          <section
            className={`${styles.publicDecisionBanner} ${
              canDecide ? styles.publicDecisionBannerPending : styles.publicDecisionBannerComplete
            }`}
          >
            <div className={styles.publicDecisionBannerBody}>
              <p className={styles.publicDecisionBannerEyebrow}>Decision</p>
              {canDecide ? (
                <p className={styles.publicDecisionBannerText}>
                  Ready to sign? Jump to the decision section and submit your response.
                </p>
              ) : (
                <p className={styles.publicDecisionBannerText}>{nonPendingDecisionMessage}</p>
              )}
            </div>
            {canDecide ? (
              <a href="#change-order-decision" className={styles.publicDecisionBannerLink}>
                Review & Sign
              </a>
            ) : null}
          </section>

          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Change Order</p>
              <h2 className={styles.title}>
                CO-{changeOrder.family_key} v{changeOrder.revision_number}
              </h2>
              <p className={styles.subhead}>{changeOrder.title}</p>
              <p className={styles.subhead}>
                {changeOrder.project_context?.name} · {changeOrder.project_context?.customer_display_name}
              </p>
            </div>
            <div className={styles.headerRight}>
              <span className={`${styles.statusBadge} ${statusClass(changeOrder.status)}`}>
                {statusLabel(changeOrder.status)}
              </span>
              <strong className={styles.totalDelta}>${formatMoney(changeOrder.amount_delta)}</strong>
              <span className={styles.deltaMeta}>Schedule delta: {changeOrder.days_delta} day(s)</span>
            </div>
          </header>

          {changeOrder.origin_estimate_context ? (
            <div className={styles.contextRow}>
              Origin estimate: #{changeOrder.origin_estimate_context.id} · v
              {changeOrder.origin_estimate_context.version} · {changeOrder.origin_estimate_context.title}
            </div>
          ) : null}

          <section className={styles.lineSection}>
            <h3>Line Items</h3>
            {changeOrder.line_items?.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Budget Line</th>
                      <th>Description</th>
                      <th>Amount Delta</th>
                      <th>Days Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeOrder.line_items.map((line) => (
                      <tr key={line.id}>
                        <td>{line.line_type === "adjustment" ? "Adjustment" : "Scope"}</td>
                        <td>
                          #{line.budget_line} {line.budget_line_cost_code}
                        </td>
                        <td>{line.description || line.budget_line_description}</td>
                        <td>${formatMoney(line.amount_delta)}</td>
                        <td>{line.days_delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.emptyHint}>No line items available.</p>
            )}
          </section>

          <section className={styles.reasonCard}>
            <h4>Reason</h4>
            <p>{changeOrder.reason || "No reason provided."}</p>
            <p className={styles.updatedText}>Updated {formatDateDisplay(changeOrder.updated_at, "Unknown date")}</p>
          </section>

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
    </section>
  );
}
