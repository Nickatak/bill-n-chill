"use client";

/**
 * Public-facing change-order preview for customer decision flow.
 * Renders a read-only change-order document via a tokenized public URL and
 * provides approve/reject controls for change orders in "sent" status.
 *
 * Parent: app/change-order/[publicRef]/page.tsx
 */

import { useEffect, useMemo, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import Image from "next/image";
import { parseAmount, formatDecimal } from "@/shared/money-format";
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
import { usePrintContext } from "@/shared/hooks/use-print-context";
import { SigningCeremony, type CeremonyPayload } from "@/shared/document-viewer/signing-ceremony";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import styles from "./change-order-public-preview.module.css";

type ChangeOrderPublicPreviewProps = {
  publicToken: string;
};

/** Build the public-facing estimate URL for a cross-reference link. */
function publicEstimateHref(publicRef?: string): string {
  if (!publicRef) {
    return "";
  }
  return `/estimate/${publicRef}`;
}

/** Renders the public change-order preview and customer decision form. */
export function ChangeOrderPublicPreview({ publicToken }: ChangeOrderPublicPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading change order...");
  const [changeOrder, setChangeOrder] = useState<ChangeOrderRecord | null>(null);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionReceiptName, setDecisionReceiptName] = useState("");
  const { ref: decisionSectionRef, flash: flashDecision } = useCreatorFlash();
  const { printTimestamp } = usePrintContext();

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canDecide = changeOrder?.status === "sent";
  const hasDecision = changeOrder?.status === "approved" || changeOrder?.status === "rejected";
  const sender = useMemo(
    () => resolvePublicSender(changeOrder?.organization_context, changeOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally granular deps
    [changeOrder?.organization_context, changeOrder?.sender_name, changeOrder?.sender_address, changeOrder?.sender_logo_url],
  );
  const recipient = useMemo(
    () => resolvePublicRecipient(changeOrder?.project_context),
    [changeOrder?.project_context],
  );
  const termsText = useMemo(() => {
    const documentTerms = (changeOrder?.terms_text || "").trim();
    if (documentTerms) return documentTerms;
    const organizationTerms = resolveDefaultTerms(changeOrder?.organization_context, "change_order");
    return organizationTerms || "No terms specified.";
  }, [changeOrder?.organization_context, changeOrder?.terms_text]);
  const reasonFallback = useMemo(() => {
    const organizationReason = resolveDefaultTerms(changeOrder?.organization_context, "change_order");
    return organizationReason || "No reason provided.";
  }, [changeOrder?.organization_context]);

  // Clear stale decision feedback when the change order is no longer actionable.
  useEffect(() => {
    if (!canDecide) {
      setDecisionMessage("");
    }
  }, [canDecide]);

  // Fetch the change order record from the public token on mount.
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

  /** Submit the customer's approve/reject decision with signing ceremony data. */
  async function applyDecision(decision: string, ceremony: CeremonyPayload) {
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
            note: ceremony.note,
            session_token: ceremony.session_token,
            signer_name: ceremony.signer_name,
            consent_accepted: ceremony.consent_accepted,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        setDecisionMessage(payload.error?.message || "Could not apply decision.");
        return;
      }
      setChangeOrder(payload.data as ChangeOrderRecord);

      setDecisionReceiptName(ceremony.signer_name);
      setDecisionMessage("");
      flashDecision();
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
        changeOrder && canDecide
          ? {
              tone: "pending" as const,
              eyebrow: "Decision",
              text: "Ready to sign? Jump to the decision section and submit your response.",
              linkHref: "#change-order-decision",
              linkLabel: "Review & Sign",
              stateClassName: styles.decisionBannerAwaiting,
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
                    <Image
                      className={frameStyles.logoImage}
                      src={sender.logoUrl}
                      alt={`${sender.companyName} logo`}
                      width={200}
                      height={80}
                      unoptimized
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
                  {changeOrder.origin_estimate_context ? (
                    <>
                      {changeOrder.origin_estimate_context.public_ref ? (
                        <a
                          className={`${frameStyles.metaLink} ${creatorStyles.screenOnly}`}
                          href={publicEstimateHref(changeOrder.origin_estimate_context.public_ref)}
                        >
                          View Estimate
                        </a>
                      ) : null}
                      <span className={creatorStyles.printOnly}>
                        Estimate: {changeOrder.origin_estimate_context.title || `#${changeOrder.origin_estimate_context.id}`}
                        {changeOrder.origin_estimate_context.version ? ` v${changeOrder.origin_estimate_context.version}` : ""}
                      </span>
                    </>
                  ) : null}
                </div>
              </>
            }
            lineTitle="Line Items"
            columns={["Cost Code", "Description", "Amount Delta", "Days Delta"]}
            mobileColumnLayout={[
              { order: 1, span: "full" },   // Cost Code
              { order: 0, span: "full" },   // Description
              { order: 2, span: "half" },   // Amount Delta
              { order: 3, span: "half" },   // Days Delta
            ]}
            rows={(changeOrder.line_items ?? []).map((line) => ({
              key: line.id,
              cells: [
                line.cost_code_code || "—",
                line.description || "—",
                `$${formatDecimal(parseAmount(line.amount_delta))}`,
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
                      <strong>${formatDecimal(parseAmount(changeOrder.amount_delta))}</strong>
                    </div>
                    <div className={styles.totalRow}>
                      <span>Schedule delta</span>
                      <strong>{changeOrder.days_delta} day(s)</strong>
                    </div>
                  </section>
                </div>
                {changeOrder.origin_estimate_context?.line_items?.length ||
                changeOrder.approved_sibling_change_orders?.length ? (
                  <div className={styles.breakdownSection}>
                    <h4 className={frameStyles.panelTitle}>Contract Breakdown</h4>

                    {changeOrder.origin_estimate_context?.line_items?.length ? (
                      <>
                        <p className={styles.breakdownLabel}>
                          Approved Estimate: {changeOrder.origin_estimate_context.title} v
                          {changeOrder.origin_estimate_context.version}
                        </p>
                        <div className={frameStyles.tableWrap}>
                          <table className={frameStyles.table}>
                            <thead>
                              <tr>
                                <th>Cost Code</th>
                                <th>Description</th>
                                <th>Qty</th>
                                <th>Unit</th>
                                <th>Unit Cost</th>
                                <th>Markup %</th>
                                <th>Line Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changeOrder.origin_estimate_context.line_items.map((line) => (
                                <tr key={line.id}>
                                  <td>{line.cost_code_code || "—"}</td>
                                  <td>{line.description || "—"}</td>
                                  <td>{line.quantity}</td>
                                  <td>{line.unit}</td>
                                  <td>${line.unit_price}</td>
                                  <td>{line.markup_percent}%</td>
                                  <td>${line.line_total}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className={styles.totalRow}>
                          <span>Estimate Grand Total</span>
                          <strong>${changeOrder.origin_estimate_context.grand_total}</strong>
                        </div>
                      </>
                    ) : null}

                    {changeOrder.approved_sibling_change_orders?.length ? (
                      <>
                        <p className={styles.breakdownLabel}>
                          Approved Change Orders ({changeOrder.approved_sibling_change_orders.length})
                        </p>
                        <div className={frameStyles.tableWrap}>
                          <table className={frameStyles.table}>
                            <thead>
                              <tr>
                                <th>CO #</th>
                                <th>Cost Code</th>
                                <th>Description</th>
                                <th>Adjustment Reason</th>
                                <th>Amount Delta</th>
                                <th>Days Delta</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changeOrder.approved_sibling_change_orders.flatMap((co) =>
                                co.line_items.map((line, idx) => (
                                  <tr key={`${co.id}-${line.id}`}>
                                    {idx === 0 ? (
                                      <td rowSpan={co.line_items.length}>
                                        {co.title} r{co.revision_number}
                                      </td>
                                    ) : null}
                                    <td>{line.cost_code_code || "—"}</td>
                                    <td>{line.description || "—"}</td>
                                    <td>{line.adjustment_reason || "—"}</td>
                                    <td>${formatDecimal(parseAmount(line.amount_delta))}</td>
                                    <td>{line.days_delta}</td>
                                  </tr>
                                )),
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}

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

          {canDecide ? (
            <div ref={decisionSectionRef} id="change-order-decision">
              {decisionMessage ? <p className={styles.decisionMessage}>{decisionMessage}</p> : null}
              <SigningCeremony
                publicToken={publicToken}
                documentType="change_order"
                documentSummary={{
                  type: "Change Order",
                  title: changeOrder.title || `CO-${changeOrder.family_key}`,
                  total: `$${formatDecimal(parseAmount(changeOrder.amount_delta))}`,
                }}
                customerEmailAvailable={Boolean(changeOrder.project_context?.customer_email)}
                consentText={changeOrder.ceremony_consent_text ?? ""}
                decisions={[
                  { label: "Approve Change Order", value: "approve", variant: "primary" },
                  { label: "Reject Change Order", value: "reject", variant: "secondary" },
                ]}
                onDecision={applyDecision}
                disabled={decisionSubmitting}
              />
            </div>
          ) : null}
          {hasDecision ? (
            <div
              ref={decisionSectionRef}
              className={`${stampStyles.decisionStamp} ${
                changeOrder?.status === "approved" ? stampStyles.decisionStampApproved
                : stampStyles.decisionStampRejected
              }`}
            >
              <p className={stampStyles.decisionStampLabel}>
                {changeOrder?.status === "approved" ? "Approved" : "Rejected"}
              </p>
              {decisionReceiptName.trim() ? (
                <p className={stampStyles.decisionStampDetail}>by {decisionReceiptName.trim()}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </PublicDocumentViewerShell>
  );
}
