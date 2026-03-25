/**
 * Shared test fixtures for the invoices feature test suite.
 */

import type { InvoicePolicyContract, InvoiceRecord } from "../types";
import type { InvoiceStatusEvent } from "../document-adapter";

// ---------------------------------------------------------------------------
// Policy contract
// ---------------------------------------------------------------------------

export const policyContract: InvoicePolicyContract = {
  policy_version: "1",
  statuses: ["draft", "sent", "outstanding", "closed", "void"],
  status_labels: {
    draft: "Draft",
    sent: "Sent",
    outstanding: "Outstanding",
    closed: "Closed",
    void: "Void",
  },
  default_create_status: "draft",
  default_status_filters: ["draft", "sent", "outstanding"],
  allowed_status_transitions: {
    draft: ["sent", "void"],
    sent: ["closed", "void"],
    outstanding: ["closed"],
  },
  terminal_statuses: ["closed", "void"],
};

// ---------------------------------------------------------------------------
// Status events
// ---------------------------------------------------------------------------

export const statusEvents: InvoiceStatusEvent[] = [
  {
    id: 1,
    from_status: null,
    to_status: "draft",
    note: "Created",
    actor_email: "alice@example.com",
    created_at: "2026-02-01T09:00:00Z",
  },
  {
    id: 2,
    from_status: "draft",
    to_status: "sent",
    note: "Sent to customer",
    actor_email: "bob@example.com",
    created_at: "2026-02-05T14:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Invoice record (API shape)
// ---------------------------------------------------------------------------

export const invoiceRecord: InvoiceRecord = {
  id: 20,
  project: 3,
  customer: 5,
  customer_display_name: "Jane Smith",
  invoice_number: "INV-0020",
  public_ref: "inv-abc-123",
  status: "sent",
  issue_date: "2026-02-01",
  due_date: "2026-03-03",
  sender_name: "Acme Construction",
  sender_email: "billing@acme.com",
  sender_address: "123 Main St",
  sender_logo_url: "",
  terms_text: "Net 30",
  footer_text: "",
  notes_text: "",
  subtotal: "3000.00",
  tax_percent: "8.25",
  tax_total: "247.50",
  total: "3247.50",
  balance_due: "3247.50",
};

// ---------------------------------------------------------------------------
// Form state (component shape)
// ---------------------------------------------------------------------------

export const formState = {
  issueDate: "2026-02-01",
  dueDate: "2026-03-03",
  taxPercent: "8.25",
  termsText: "Net 30",
  subtotal: 3000,
  taxAmount: 247.5,
  totalAmount: 3247.5,
  lineItems: [
    {
      localId: 1,
      costCode: "50",
      description: "Foundation work",
      quantity: "1",
      unit: "lot",
      unitPrice: "3000.00",
    },
  ],
};
