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
import { ApiResponse, InvoiceRecord } from "../types";
import styles from "./invoice-public-preview.module.css";

type InvoicePublicPreviewProps = {
  publicToken: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

function parseAmount(value?: string): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value?: string): string {
  return parseAmount(value).toFixed(2);
}

function invoiceStatusLabel(status?: string): string {
  const normalized = (status || "").trim();
  return STATUS_LABELS[normalized] || normalized || "Unknown";
}

function formatDisplayDate(value?: string): string {
  if (!value) {
    return "Not set";
  }
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function InvoicePublicPreview({ publicToken }: InvoicePublicPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading invoice...");
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [paymentTestMessage, setPaymentTestMessage] = useState("");
  const [printTimestamp, setPrintTimestamp] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const sender = useMemo(
    () =>
      resolvePublicSender({
        ...invoice?.organization_context,
        sender_name: invoice?.organization_context?.sender_name || invoice?.sender_name,
        sender_email: invoice?.organization_context?.sender_email || invoice?.sender_email,
        sender_address: invoice?.organization_context?.sender_address || invoice?.sender_address,
        logo_url: invoice?.organization_context?.logo_url || invoice?.sender_logo_url,
      }),
    [
      invoice?.organization_context,
      invoice?.sender_address,
      invoice?.sender_email,
      invoice?.sender_logo_url,
      invoice?.sender_name,
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
  const paymentEligible =
    invoice?.status === "sent" || invoice?.status === "partially_paid" || invoice?.status === "overdue";
  const showPaymentSection = paymentEligible;
  const paymentStatusLabel = invoiceStatusLabel(invoice?.status);
  const paymentBannerMessage = paymentEligible
    ? "Ready to pay? Jump to the payment section and submit a test payment."
    : `Invoice status: ${paymentStatusLabel}. This invoice is not awaiting payment.`;

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
        setPaymentTestMessage("");
        setStatusMessage("");
      } catch {
        setStatusMessage("Could not reach invoice endpoint.");
      }
    }

    void loadInvoice();
  }, [normalizedBaseUrl, publicToken]);

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

  function handleTestPayment(mode: "half" | "full") {
    if (!invoice) {
      return;
    }
    const balanceDue = parseAmount(invoice.balance_due || invoice.total);
    const amount = mode === "half" ? balanceDue / 2 : balanceDue;
    const label = mode === "half" ? "Test Pay 50%" : "Test Pay Full";
    setPaymentTestMessage(`${label} clicked for $${amount.toFixed(2)}. Test mode only: no real charge was processed.`);
  }

  return (
    <PublicDocumentViewerShell
      classNames={publicDocumentViewerClassNames()}
      statusMessage={statusMessage}
      banner={
        invoice
          ? {
              tone: paymentEligible ? "pending" : "complete",
              eyebrow: "Payment",
              text: paymentBannerMessage,
              linkHref: paymentEligible ? "#invoice-payment" : undefined,
              linkLabel: paymentEligible ? "Open Payment Form" : undefined,
              stateClassName: paymentEligible ? styles.paymentBannerAwaiting : styles.paymentBannerSettled,
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
                  {sender.senderEmail ? (
                    <p className={frameStyles.partySecondary}>{sender.senderEmail}</p>
                  ) : null}
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
                    <span>{formatDisplayDate(invoice.issue_date)}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Due date</span>
                    <span>{formatDisplayDate(invoice.due_date)}</span>
                  </div>
                  <div className={frameStyles.metaDetailsRow}>
                    <span>Status</span>
                    <span>{paymentStatusLabel}</span>
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
                `$${formatMoney(line.unit_price)}`,
                `$${formatMoney(line.line_total)}`,
              ],
            }))}
            afterTable={
              <div className={styles.summaryWrap}>
                <div className={frameStyles.summaryBox}>
                  <div className={frameStyles.summaryRow}>
                    <span>Subtotal</span>
                    <span>${formatMoney(invoice.subtotal)}</span>
                  </div>
                  <div className={frameStyles.summaryRow}>
                    <span>Sales Tax ({parseAmount(invoice.tax_percent).toFixed(2)}%)</span>
                    <span>${formatMoney(invoice.tax_total)}</span>
                  </div>
                  <div className={`${frameStyles.summaryRow} ${frameStyles.summaryTotal}`}>
                    <span>Total</span>
                    <span>${formatMoney(invoice.total)}</span>
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

          {showPaymentSection ? (
            <section id="invoice-payment" className={`${styles.paymentSection} ${styles.paymentCard}`}>
              <h3>Payment</h3>
              <p className={styles.paymentInactiveBanner}>
                Test mode only. Payment inputs stay disabled; use the test buttons to validate UX flow without
                charging.
              </p>
              <p className={styles.paymentHint}>
                Current status: {paymentStatusLabel}. Balance due: ${formatMoney(invoice.balance_due)}.
              </p>
              {paymentTestMessage ? <p className={styles.paymentTestMessage}>{paymentTestMessage}</p> : null}
              <div className={styles.paymentGrid}>
                <label className={styles.paymentField}>
                  Cardholder name
                  <input
                    className={styles.paymentInput}
                    value=""
                    onChange={() => undefined}
                    placeholder="Name on card"
                    disabled
                  />
                </label>
                <label className={styles.paymentField}>
                  Card number
                  <input
                    className={styles.paymentInput}
                    value=""
                    onChange={() => undefined}
                    placeholder="4242 4242 4242 4242"
                    disabled
                  />
                </label>
              </div>
              <div className={styles.paymentGridTight}>
                <label className={styles.paymentField}>
                  Expiration
                  <input
                    className={styles.paymentInput}
                    value=""
                    onChange={() => undefined}
                    placeholder="MM/YY"
                    disabled
                  />
                </label>
                <label className={styles.paymentField}>
                  CVC
                  <input
                    className={styles.paymentInput}
                    value=""
                    onChange={() => undefined}
                    placeholder="123"
                    disabled
                  />
                </label>
                <label className={styles.paymentField}>
                  Billing ZIP
                  <input
                    className={styles.paymentInput}
                    value=""
                    onChange={() => undefined}
                    placeholder="90210"
                    disabled
                  />
                </label>
              </div>
              <label className={styles.paymentField}>
                Receipt email
                <input
                  className={styles.paymentInput}
                  value=""
                  onChange={() => undefined}
                  placeholder="customer@example.com"
                  disabled
                />
              </label>
              <div className={styles.paymentActions}>
                <button
                  type="button"
                  className={styles.paymentSecondaryButton}
                  onClick={() => handleTestPayment("half")}
                >
                  Test Pay 50% (${formatMoney(String(parseAmount(invoice.balance_due || invoice.total) / 2))})
                </button>
                <button
                  type="button"
                  className={styles.paymentPrimaryButton}
                  onClick={() => handleTestPayment("full")}
                >
                  Test Pay Full (${formatMoney(invoice.balance_due || invoice.total)})
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </PublicDocumentViewerShell>
  );
}
