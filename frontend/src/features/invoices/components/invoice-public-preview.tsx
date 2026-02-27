"use client";

import { useEffect, useMemo, useState } from "react";
import { toAddressLines } from "@/shared/document-composer";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { ApiResponse, InvoiceRecord } from "../types";
import styles from "./invoice-public-preview.module.css";
import estimateStyles from "../../estimates/components/estimates-console.module.css";

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

function customerAddressLines(address: string): string[] {
  return address
    .replace(/\s*,\s*/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function InvoicePublicPreview({ publicToken }: InvoicePublicPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading invoice...");
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [paymentTestMessage, setPaymentTestMessage] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const senderAddressLines = useMemo(() => toAddressLines(invoice?.sender_address || ""), [invoice?.sender_address]);
  const billingLines = useMemo(
    () => customerAddressLines(invoice?.project_context?.customer_billing_address || ""),
    [invoice?.project_context?.customer_billing_address],
  );
  const paymentEligible =
    invoice?.status === "sent" || invoice?.status === "partially_paid" || invoice?.status === "overdue";
  const paymentStatusLabel = invoiceStatusLabel(invoice?.status);
  const paymentBannerMessage = paymentEligible
    ? "Use the payment form below to run a test payment. Test mode only: no real charge is made."
    : `Invoice status: ${paymentStatusLabel}. Test payment buttons are available for sandbox validation only.`;

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
    <div className={styles.preview}>
      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

      {invoice ? (
        <>
          <section
            className={`${estimateStyles.publicDecisionBanner} ${
              paymentEligible ? estimateStyles.publicDecisionBannerPending : estimateStyles.publicDecisionBannerComplete
            }`}
          >
            <div className={estimateStyles.publicDecisionBannerBody}>
              <p className={estimateStyles.publicDecisionBannerEyebrow}>Payment</p>
              <p className={estimateStyles.publicDecisionBannerText}>{paymentBannerMessage}</p>
            </div>
            <a href="#invoice-payment" className={estimateStyles.publicDecisionBannerLink}>
              Open Payment Form
            </a>
          </section>

          <section className={`${estimateStyles.sheet} ${estimateStyles.sheetReadOnly}`}>
            <div className={estimateStyles.sheetHeader}>
              <div className={estimateStyles.fromBlock}>
                <span className={estimateStyles.blockLabel}>From</span>
                <p className={estimateStyles.blockText}>{invoice.sender_name || "Your Company"}</p>
                {invoice.sender_email ? <p className={estimateStyles.blockMuted}>{invoice.sender_email}</p> : null}
                {senderAddressLines.length ? (
                  senderAddressLines.map((line, index) => (
                    <p key={`${line}-${index}`} className={estimateStyles.blockMuted}>
                      {line}
                    </p>
                  ))
                ) : (
                  <p className={estimateStyles.blockMuted}>Set sender address in Organization settings.</p>
                )}
              </div>
              <div className={estimateStyles.headerRight}>
                <div className={estimateStyles.logoBox}>
                  {invoice.sender_logo_url ? (
                    <a
                      className={estimateStyles.logoUrlLink}
                      href={invoice.sender_logo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {invoice.sender_logo_url}
                    </a>
                  ) : (
                    "No logo URL set"
                  )}
                </div>
                <div className={estimateStyles.sheetTitle}>Invoice</div>
              </div>
            </div>

            <div className={estimateStyles.partyGrid}>
              <div className={estimateStyles.toBlock}>
                <span className={estimateStyles.blockLabel}>To</span>
                <p className={estimateStyles.blockText}>
                  {invoice.project_context?.customer_display_name || invoice.customer_display_name}
                </p>
                {billingLines.length ? (
                  billingLines.map((line, index) => (
                    <p key={`${line}-${index}`} className={estimateStyles.blockMuted}>
                      {line}
                    </p>
                  ))
                ) : (
                  <p className={estimateStyles.blockMuted}>Billing address unavailable.</p>
                )}
              </div>
              <div className={estimateStyles.metaBlock}>
                <div className={estimateStyles.metaTitle}>Invoice Details</div>
                <div className={estimateStyles.metaLine}>
                  <span>Invoice #</span>
                  <span>{invoice.invoice_number || `#${invoice.id}`}</span>
                </div>
                <div className={estimateStyles.metaLine}>
                  <span>Issue date</span>
                  <span className={estimateStyles.staticMetaValue}>{formatDisplayDate(invoice.issue_date)}</span>
                </div>
                <div className={estimateStyles.metaLine}>
                  <span>Due date</span>
                  <span className={estimateStyles.staticMetaValue}>{formatDisplayDate(invoice.due_date)}</span>
                </div>
              </div>
            </div>

            <div className={estimateStyles.lineTable}>
              <div
                className={`${estimateStyles.lineHeader} ${estimateStyles.lineHeaderReadOnly} ${estimateStyles.lineHeaderNoMarkup}`}
              >
                <div className={estimateStyles.lineHeaderCell}>
                  <span>Qty</span>
                </div>
                <div className={estimateStyles.lineHeaderCell}>
                  <span>Description</span>
                </div>
                <div className={estimateStyles.lineHeaderCell}>
                  <span>Cost Code</span>
                </div>
                <div className={estimateStyles.lineHeaderCell}>
                  <span>Unit</span>
                </div>
                <div className={estimateStyles.lineHeaderCell}>
                  <span>Unit Price</span>
                </div>
                <div className={estimateStyles.lineHeaderCell}>
                  <span>Amount</span>
                </div>
              </div>

              {invoice.line_items?.length ? (
                invoice.line_items.map((line) => (
                  <div
                    key={line.id}
                    className={`${estimateStyles.lineRow} ${estimateStyles.lineRowReadOnly} ${estimateStyles.lineRowNoMarkup}`}
                  >
                    <div className={estimateStyles.lineCell}>
                      <span className={estimateStyles.staticCellValue}>{line.quantity}</span>
                    </div>
                    <div className={estimateStyles.lineCell}>
                      <span className={estimateStyles.staticCellValue}>{line.description || "No description"}</span>
                    </div>
                    <div className={estimateStyles.lineCell}>
                      <span className={estimateStyles.staticCellValue}>{line.budget_line_cost_code || "N/A"}</span>
                    </div>
                    <div className={estimateStyles.lineCell}>
                      <span className={estimateStyles.staticCellValue}>{line.unit || "ea"}</span>
                    </div>
                    <div className={estimateStyles.lineCell}>
                      <span className={estimateStyles.staticCellValue}>${formatMoney(line.unit_price)}</span>
                    </div>
                    <div className={estimateStyles.lineCell}>
                      <div className={estimateStyles.amountCell}>${formatMoney(line.line_total)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div
                  className={`${estimateStyles.lineRow} ${estimateStyles.lineRowReadOnly} ${estimateStyles.lineRowNoMarkup}`}
                >
                  <div className={estimateStyles.lineCell}>
                    <span className={estimateStyles.staticCellValue}>0</span>
                  </div>
                  <div className={estimateStyles.lineCell}>
                    <span className={estimateStyles.staticCellValue}>No line items available.</span>
                  </div>
                  <div className={estimateStyles.lineCell}>
                    <span className={estimateStyles.staticCellValue}>-</span>
                  </div>
                  <div className={estimateStyles.lineCell}>
                    <span className={estimateStyles.staticCellValue}>-</span>
                  </div>
                  <div className={estimateStyles.lineCell}>
                    <span className={estimateStyles.staticCellValue}>$0.00</span>
                  </div>
                  <div className={estimateStyles.lineCell}>
                    <div className={estimateStyles.amountCell}>$0.00</div>
                  </div>
                </div>
              )}
            </div>

            <div className={estimateStyles.summary}>
              <div className={estimateStyles.summaryRow}>
                <span>Subtotal</span>
                <span>${formatMoney(invoice.subtotal)}</span>
              </div>
              <div className={estimateStyles.summaryRow}>
                <span>Sales Tax ({parseAmount(invoice.tax_percent).toFixed(2)}%)</span>
                <span>${formatMoney(invoice.tax_total)}</span>
              </div>
              <div className={`${estimateStyles.summaryRow} ${estimateStyles.summaryTotal}`}>
                <span>Total</span>
                <span>${formatMoney(invoice.total)}</span>
              </div>
            </div>

            <div className={estimateStyles.terms}>
              <h4>Terms and Conditions</h4>
              {(invoice.terms_text || "No terms specified.")
                .split("\n")
                .filter((line) => line.trim())
                .map((line, index) => (
                  <p key={`terms-${line}-${index}`}>{line}</p>
                ))}
              {invoice.notes_text?.trim() ? <p>Notes: {invoice.notes_text}</p> : null}
              {invoice.footer_text?.trim() ? <p>{invoice.footer_text}</p> : null}
            </div>

            <div className={estimateStyles.footer}>
              <span>{invoice.sender_name || "Your Company"}</span>
              <span>{invoice.sender_email || "billing@example.com"}</span>
              <span>{senderAddressLines[0] || "Set address in Organization settings"}</span>
            </div>
          </section>

          <section
            id="invoice-payment"
            className={`${estimateStyles.lifecycle} ${estimateStyles.publicDecisionSection} ${styles.paymentSection}`}
          >
            <h3>Payment</h3>
            <p className={styles.paymentInactiveBanner}>
              Test mode only. Payment inputs stay disabled; use the test buttons to validate UX flow without charging.
            </p>
            <p className={estimateStyles.inlineHint}>
              Current status: {paymentStatusLabel}. Balance due: ${formatMoney(invoice.balance_due)}.
            </p>
            {paymentTestMessage ? <p className={styles.paymentTestMessage}>{paymentTestMessage}</p> : null}
            <div className={styles.paymentGrid}>
              <label className={estimateStyles.lifecycleField}>
                Cardholder name
                <input
                  className={estimateStyles.fieldInput}
                  value=""
                  onChange={() => undefined}
                  placeholder="Name on card"
                  disabled
                />
              </label>
              <label className={estimateStyles.lifecycleField}>
                Card number
                <input
                  className={estimateStyles.fieldInput}
                  value=""
                  onChange={() => undefined}
                  placeholder="4242 4242 4242 4242"
                  disabled
                />
              </label>
            </div>
            <div className={styles.paymentGridTight}>
              <label className={estimateStyles.lifecycleField}>
                Expiration
                <input
                  className={estimateStyles.fieldInput}
                  value=""
                  onChange={() => undefined}
                  placeholder="MM/YY"
                  disabled
                />
              </label>
              <label className={estimateStyles.lifecycleField}>
                CVC
                <input
                  className={estimateStyles.fieldInput}
                  value=""
                  onChange={() => undefined}
                  placeholder="123"
                  disabled
                />
              </label>
              <label className={estimateStyles.lifecycleField}>
                Billing ZIP
                <input
                  className={estimateStyles.fieldInput}
                  value=""
                  onChange={() => undefined}
                  placeholder="90210"
                  disabled
                />
              </label>
            </div>
            <label className={estimateStyles.lifecycleField}>
              Receipt email
              <input
                className={estimateStyles.fieldInput}
                value=""
                onChange={() => undefined}
                placeholder="customer@example.com"
                disabled
              />
            </label>
            <div className={estimateStyles.lifecycleActions}>
              <button
                type="button"
                className={estimateStyles.secondaryButton}
                onClick={() => handleTestPayment("half")}
              >
                Test Pay 50% (${formatMoney(String(parseAmount(invoice.balance_due || invoice.total) / 2))})
              </button>
              <button
                type="button"
                className={estimateStyles.primaryButton}
                onClick={() => handleTestPayment("full")}
              >
                Test Pay Full (${formatMoney(invoice.balance_due || invoice.total)})
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
