"use client";

/**
 * Public-facing invoice preview rendered via a tokenized URL.
 * Fetches the invoice by public token and displays it in the shared document viewer shell,
 * including sender/recipient context, line items, totals, terms, and a test payment section.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
import { parseAmount, formatDecimal } from "@/shared/money-format";
import { formatDateDisplay } from "@/shared/date-format";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { ApiResponse, InvoiceRecord } from "../types";
import { usePrintContext } from "@/shared/hooks/use-print-context";
import { SigningCeremony, type CeremonyPayload } from "@/shared/document-viewer/signing-ceremony";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import styles from "./invoice-public-preview.module.css";

type InvoicePublicPreviewProps = {
  publicToken: string;
};

/** Maps API status values to user-facing display labels. */
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  void: "Void",
};

/** Resolve a human-readable label for an invoice status value. */
function invoiceStatusLabel(status?: string): string {
  const normalized = (status || "").trim();
  return STATUS_LABELS[normalized] || normalized || "Unknown";
}

/** Renders the public invoice preview page for a customer accessing via tokenized URL. */
export function InvoicePublicPreview({ publicToken }: InvoicePublicPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading invoice...");
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [decisionReceiptName, setDecisionReceiptName] = useState("");
  const decisionSectionRef = useRef<HTMLDivElement | null>(null);
  const [decisionFlashCount, setDecisionFlashCount] = useState(0);
  const { printTimestamp } = usePrintContext();

  useEffect(() => {
    if (decisionFlashCount === 0) return;
    const el = decisionSectionRef.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [decisionFlashCount]);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const sender = useMemo(
    () =>
      resolvePublicSender({
        ...invoice?.organization_context,
        display_name:
          invoice?.sender_name || invoice?.organization_context?.display_name,
        logo_url:
          invoice?.sender_logo_url || invoice?.organization_context?.logo_url,
      }),
    [
      invoice?.organization_context,
      invoice?.sender_name,
      invoice?.sender_logo_url,
    ],
  );
  const recipient = useMemo(
    () =>
      resolvePublicRecipient({
        ...invoice?.project_context,
        customer_display_name:
          invoice?.project_context?.customer_display_name || invoice?.customer_display_name,
      }),
    [invoice?.customer_display_name, invoice?.project_context],
  );
  const termsText = useMemo(() => {
    const organizationTerms = resolveDefaultTerms(invoice?.organization_context, "invoice");
    return organizationTerms || (invoice?.terms_text || "").trim() || "No terms specified.";
  }, [invoice?.organization_context, invoice?.terms_text]);
  const canDecide =
    invoice?.status === "sent" || invoice?.status === "partially_paid";
  const decisionStatusLabel = invoiceStatusLabel(invoice?.status);

  // Clear stale decision feedback when the invoice is no longer actionable.
  useEffect(() => {
    if (!canDecide) {
      setDecisionMessage("");
    }
  }, [canDecide]);

  // Fetch invoice data on mount using the public token.
  useEffect(() => {
    async function loadInvoice() {
      try {
        const response = await fetch(`${normalizedBaseUrl}/public/invoices/${publicToken}/`);
        const payload: ApiResponse = await response.json();
        if (!response.ok || !payload.data || Array.isArray(payload.data)) {
          setStatusMessage("Invoice not found.");
          return;
        }
        setInvoice(payload.data as InvoiceRecord);
        setDecisionReceiptName("");
        setStatusMessage("");
      } catch {
        setStatusMessage("Could not reach invoice endpoint.");
      }
    }

    void loadInvoice();
  }, [normalizedBaseUrl, publicToken]);

  /** Submit the customer's approve/dispute decision with signing ceremony data. */
  async function applyDecision(decision: string, ceremony: CeremonyPayload) {
    if (!invoice || !canDecide || decisionSubmitting) {
      return;
    }

    setDecisionSubmitting(true);
    setDecisionMessage("");

    try {
      const response = await fetch(
        `${normalizedBaseUrl}/public/invoices/${publicToken}/decision/`,
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
      setInvoice(payload.data as InvoiceRecord);

      setDecisionReceiptName(ceremony.signer_name);
      setDecisionMessage("");
      setDecisionFlashCount((c) => c + 1);
    } catch {
      setDecisionMessage("Could not reach invoice decision endpoint.");
    } finally {
      setDecisionSubmitting(false);
    }
  }

  return (
    <PublicDocumentViewerShell
      classNames={publicDocumentViewerClassNames()}
      statusMessage={statusMessage}
      banner={
        invoice && canDecide
          ? {
              tone: "pending" as const,
              eyebrow: "Decision",
              text: "Ready to sign? Jump to the decision section and submit your response.",
              linkHref: "#invoice-decision",
              linkLabel: "Review & Sign",
              stateClassName: styles.paymentBannerAwaiting,
            }
          : undefined
      }
    >
      {invoice ? (
        <>
          <PublicDocumentFrame
            headerLeft={
              <>
                <section className={frameStyles.partyBlock}>
                  <p className={frameStyles.partyLabel}>From</p>
                  <p className={frameStyles.partyPrimary}>{sender.senderName || sender.companyName}</p>
                  {sender.senderAddressLines.length ? (
                    sender.senderAddressLines.map((line, index) => (
                      <p key={`${line}-${index}`} className={frameStyles.partySecondary}>
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
                  <p className={frameStyles.identityEyebrow}>Invoice</p>
                  <h2 className={frameStyles.identityTitle}>{invoice.invoice_number || `Invoice #${invoice.id}`}</h2>
                  <p className={frameStyles.identitySubhead}>{invoice.project_context?.name || "Project"}</p>
                </div>
                <hr className={frameStyles.identityDivider} />
                <section className={`${frameStyles.metaDetails} ${styles.detailsPanel}`}>
                  <h4 className={frameStyles.metaDetailsTitle}>Invoice Details</h4>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Issue date</span>
                    <span>{formatDateDisplay(invoice.issue_date, "Not set")}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Due date</span>
                    <span>{formatDateDisplay(invoice.due_date, "Not set")}</span>
                  </div>
                </section>
              </>
            }
            lineTitle="Line Items"
            columns={["Qty", "Description", "Cost Code", "Unit", "Unit Price", "Amount"]}
            rows={(invoice.line_items ?? []).map((line) => ({
              key: line.id,
              cells: [
                line.quantity,
                line.description || "No description",
                line.budget_line_cost_code || "N/A",
                line.unit || "ea",
                `$${formatDecimal(parseAmount(line.unit_price))}`,
                `$${formatDecimal(parseAmount(line.line_total))}`,
              ],
            }))}
            afterTable={
              <div className={styles.summaryWrap}>
                <div className={frameStyles.summaryBox}>
                  <div className={frameStyles.summaryRow}>
                    <span>Subtotal</span>
                    <span>${formatDecimal(parseAmount(invoice.subtotal))}</span>
                  </div>
                  <div className={frameStyles.summaryRow}>
                    <span>Sales Tax ({parseAmount(invoice.tax_percent).toFixed(2)}%)</span>
                    <span>${formatDecimal(parseAmount(invoice.tax_total))}</span>
                  </div>
                  <div className={`${frameStyles.summaryRow} ${frameStyles.summaryTotal}`}>
                    <span>Total</span>
                    <span>${formatDecimal(parseAmount(invoice.total))}</span>
                  </div>
                </div>
              </div>
            }
            afterLineSection={
              <div className={frameStyles.terms}>
                <h4>Terms and Conditions</h4>
                {termsText
                  .split("\n")
                  .filter((line) => line.trim())
                  .map((line, index) => (
                    <p key={`terms-${line}-${index}`}>{line}</p>
                  ))}
                {invoice.notes_text?.trim() ? <p>Notes: {invoice.notes_text}</p> : null}
                {invoice.footer_text?.trim() ? <p>{invoice.footer_text}</p> : null}
              </div>
            }
            footer={
              <footer>
                <div className={frameStyles.footerRow}>
                  <span>{sender.companyName}</span>
                  <span>{sender.helpEmail || "Help email not set"}</span>
                  <span>{invoice.public_ref || publicToken}</span>
                </div>
                <div className={frameStyles.printFooter}>
                  <span>{printTimestamp}</span>
                  <span>{invoice.public_ref || publicToken}</span>
                </div>
              </footer>
            }
          />

          {canDecide ? (
            <div ref={decisionSectionRef} id="invoice-decision">
              {decisionMessage ? <p className={styles.paymentHint}>{decisionMessage}</p> : null}
              <SigningCeremony
                publicToken={publicToken}
                documentType="invoice"
                documentSummary={{
                  type: "Invoice",
                  title: invoice.invoice_number || `Invoice #${invoice.id}`,
                  total: `$${formatDecimal(parseAmount(invoice.total))}`,
                }}
                customerEmailAvailable={Boolean(invoice.project_context?.customer_email)}
                decisions={[
                  { label: "Approve Invoice", value: "approve", variant: "primary" },
                  { label: "Dispute Invoice", value: "dispute", variant: "secondary" },
                ]}
                onDecision={applyDecision}
                disabled={decisionSubmitting}
              />
            </div>
          ) : null}
          {invoice.status === "paid" ? (
            <div className={`${stampStyles.decisionStamp} ${stampStyles.decisionStampPaid}`}>
              <p className={stampStyles.decisionStampLabel}>Paid</p>
            </div>
          ) : null}
        </>
      ) : null}
    </PublicDocumentViewerShell>
  );
}
