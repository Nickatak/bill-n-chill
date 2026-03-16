"use client";

/**
 * Public-facing invoice preview rendered via a tokenized URL.
 * Fetches the invoice by public token and displays it in the shared document viewer shell,
 * including sender/recipient context, line items, totals, terms, and a test payment section.
 */

import { useEffect, useMemo, useState } from "react";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
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
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import styles from "./invoice-public-preview.module.css";

type InvoicePublicPreviewProps = {
  publicToken: string;
};

/** Renders the public invoice preview page for a customer accessing via tokenized URL. */
export function InvoicePublicPreview({ publicToken }: InvoicePublicPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading invoice...");
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [, setDecisionReceiptName] = useState("");
  const { ref: decisionSectionRef, flash: flashDecision } = useCreatorFlash();
  const { printTimestamp } = usePrintContext();

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const sender = useMemo(
    () => resolvePublicSender(invoice?.organization_context, invoice),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally granular deps
    [invoice?.organization_context, invoice?.sender_name, invoice?.sender_address, invoice?.sender_logo_url],
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
    const documentTerms = (invoice?.terms_text || "").trim();
    if (documentTerms) return documentTerms;
    const organizationTerms = resolveDefaultTerms(invoice?.organization_context, "invoice");
    return organizationTerms || "No terms specified.";
  }, [invoice?.organization_context, invoice?.terms_text]);
  const canDecide =
    invoice?.status === "sent" || invoice?.status === "partially_paid";

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
      flashDecision();
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
                    // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo
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
            columns={["Qty", "Description", "Cost Code", "Unit", "Unit Price", "Total"]}
            mobileColumnLayout={[
              { order: 2, span: "half", hidden: true },  // Qty (folded into Amount)
              { order: 0, span: "full" },                 // Description
              { order: 1, span: "full" },                 // Cost Code
              { order: 3, span: "half", hidden: true },   // Unit (folded into Amount)
              { order: 4, span: "half", hidden: true },   // Unit Price (folded into Amount)
              { order: 2, span: "full", align: "right" }, // Amount (shows breakdown)
            ]}
            rows={(invoice.line_items ?? []).map((line) => {
              const qty = Number(line.quantity || 0);
              const unitPrice = parseAmount(line.unit_price);
              const unit = line.unit || "ea";
              return {
                key: line.id,
                cells: [
                  line.quantity,
                  line.description || "No description",
                  line.cost_code ? String(line.cost_code) : "N/A",
                  unit,
                  `$${formatDecimal(unitPrice)}`,
                  <>
                    <span className={frameStyles.mobileBreakdown}>
                      {qty.toFixed(2)} {unit} × ${formatDecimal(unitPrice)}
                    </span>
                    <span>${formatDecimal(parseAmount(line.line_total))}</span>
                  </>,
                ],
              };
            })}
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
                consentText={invoice.ceremony_consent_text ?? ""}
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
