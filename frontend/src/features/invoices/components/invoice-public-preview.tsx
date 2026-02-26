"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateDisplay } from "@/shared/date-format";
import { toAddressLines } from "@/shared/document-composer";
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

function invoiceStatusClass(status?: string): string {
  if (status === "sent") {
    return styles.statusSent;
  }
  if (status === "partially_paid") {
    return styles.statusPartial;
  }
  if (status === "paid") {
    return styles.statusPaid;
  }
  if (status === "overdue") {
    return styles.statusOverdue;
  }
  if (status === "void") {
    return styles.statusVoid;
  }
  return styles.statusDraft;
}

export function InvoicePublicPreview({ publicToken }: InvoicePublicPreviewProps) {
  const [statusMessage, setStatusMessage] = useState("Loading invoice...");
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const senderAddressLines = useMemo(() => toAddressLines(invoice?.sender_address || ""), [invoice?.sender_address]);
  const customerAddressLines = useMemo(
    () => toAddressLines(invoice?.project_context?.customer_billing_address || ""),
    [invoice?.project_context?.customer_billing_address],
  );

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
        setStatusMessage("");
      } catch {
        setStatusMessage("Could not reach invoice endpoint.");
      }
    }

    void loadInvoice();
  }, [normalizedBaseUrl, publicToken]);

  return (
    <div className={styles.preview}>
      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

      {invoice ? (
        <>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Invoice</p>
              <h2 className={styles.title}>{invoice.invoice_number}</h2>
              <p className={styles.subhead}>
                {invoice.project_context?.name || "Project"} ·{" "}
                {invoice.project_context?.customer_display_name || invoice.customer_display_name}
              </p>
            </div>
            <div className={styles.headerRight}>
              <span className={`${styles.statusBadge} ${invoiceStatusClass(invoice.status)}`}>
                {invoiceStatusLabel(invoice.status)}
              </span>
              <strong className={styles.total}>${formatMoney(invoice.total)}</strong>
              <span className={styles.balance}>Balance due: ${formatMoney(invoice.balance_due)}</span>
            </div>
          </header>

          <section className={styles.metaGrid}>
            <article className={styles.metaCard}>
              <h3>From</h3>
              <p className={styles.primaryText}>{invoice.sender_name || "Sender name"}</p>
              {invoice.sender_email ? <p className={styles.secondaryText}>{invoice.sender_email}</p> : null}
              {senderAddressLines.length
                ? senderAddressLines.map((line, index) => (
                    <p key={`${line}-${index}`} className={styles.secondaryText}>
                      {line}
                    </p>
                  ))
                : <p className={styles.secondaryText}>Sender address unavailable.</p>}
            </article>
            <article className={styles.metaCard}>
              <h3>Bill To</h3>
              <p className={styles.primaryText}>
                {invoice.project_context?.customer_display_name || invoice.customer_display_name}
              </p>
              {customerAddressLines.length
                ? customerAddressLines.map((line, index) => (
                    <p key={`${line}-${index}`} className={styles.secondaryText}>
                      {line}
                    </p>
                  ))
                : <p className={styles.secondaryText}>Billing address unavailable.</p>}
              <div className={styles.dateGrid}>
                <span>Issue: {formatDateDisplay(invoice.issue_date, "Not set")}</span>
                <span>Due: {formatDateDisplay(invoice.due_date, "Not set")}</span>
              </div>
            </article>
          </section>

          <section className={styles.lineSection}>
            <h3>Line Items</h3>
            {invoice.line_items?.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th>Unit Price</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.line_items.map((line) => (
                      <tr key={line.id}>
                        <td>{line.description}</td>
                        <td>{line.quantity}</td>
                        <td>{line.unit}</td>
                        <td>${formatMoney(line.unit_price)}</td>
                        <td>${formatMoney(line.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.emptyHint}>No line items available.</p>
            )}
          </section>

          <section className={styles.footerGrid}>
            <article className={styles.footerCard}>
              <h4>Terms</h4>
              <p>{invoice.terms_text || "No terms specified."}</p>
            </article>
            <article className={styles.footerCard}>
              <h4>Notes</h4>
              <p>{invoice.notes_text || "No notes specified."}</p>
            </article>
            <article className={`${styles.footerCard} ${styles.footerCardWide}`}>
              <h4>Footer</h4>
              <p>{invoice.footer_text || "Thank you for your business."}</p>
            </article>
            <article className={styles.totalsCard}>
              <div>
                <span>Subtotal</span>
                <strong>${formatMoney(invoice.subtotal)}</strong>
              </div>
              <div>
                <span>Tax ({parseAmount(invoice.tax_percent).toFixed(2)}%)</span>
                <strong>${formatMoney(invoice.tax_total)}</strong>
              </div>
              <div className={styles.totalRow}>
                <span>Total</span>
                <strong>${formatMoney(invoice.total)}</strong>
              </div>
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
