/**
 * Shared test fixtures for the estimates feature test suite.
 */

import type { EstimatePolicyContract, EstimateStatusEventRecord } from "../types";

// ---------------------------------------------------------------------------
// Policy contract
// ---------------------------------------------------------------------------

export const policyContract: EstimatePolicyContract = {
  policy_version: "1",
  statuses: ["draft", "sent", "approved", "rejected"],
  status_labels: { draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected" },
  default_create_status: "draft",
  default_status_filters: ["draft", "sent"],
  allowed_status_transitions: {
    draft: ["sent"],
    sent: ["approved", "rejected"],
  },
  terminal_statuses: ["approved", "rejected"],
  quick_action_by_status: { approved: "change_order" },
};

// ---------------------------------------------------------------------------
// Status events
// ---------------------------------------------------------------------------

export const statusEvents: EstimateStatusEventRecord[] = [
  {
    id: 1,
    from_status: null,
    to_status: "draft",
    note: "Created",
    changed_by_email: "alice@example.com",
    changed_at: "2026-01-15T10:00:00Z",
  },
  {
    id: 2,
    from_status: "draft",
    to_status: "sent",
    note: "Sent to customer",
    changed_by_email: "bob@example.com",
    changed_at: "2026-01-16T14:30:00Z",
  },
];

// ---------------------------------------------------------------------------
// Estimate record (API shape)
// ---------------------------------------------------------------------------

export const estimateRecord = {
  id: 42,
  project: 7,
  version: 2,
  status: "sent",
  title: "Kitchen remodel",
  valid_through: "2026-03-01",
  terms_text: "Net 30",
  notes_text: "",
  sender_name: "Acme Construction",
  sender_address: "123 Main St",
  sender_logo_url: "",
  subtotal: "5000.00",
  tax_percent: "8.25",
  grand_total: "5412.50",
  created_at: "2026-01-15T10:00:00Z",
  updated_at: "2026-01-16T14:30:00Z",
};

// ---------------------------------------------------------------------------
// Form state (component shape)
// ---------------------------------------------------------------------------

export const formState = {
  title: "Kitchen remodel",
  validThrough: "2026-03-01",
  termsText: "Net 30",
  notesText: "",
  taxPercent: "8.25",
  subtotal: 5000,
  taxAmount: 412.5,
  totalAmount: 5412.5,
  lineItems: [
    {
      localId: 1,
      costCodeId: "10",
      description: "Demo work",
      quantity: "2",
      unit: "day",
      unitCost: "1500.00",
      markupPercent: "15",
    },
    {
      localId: 2,
      costCodeId: "20",
      description: "Cabinets",
      quantity: "1",
      unit: "lot",
      unitCost: "2000.00",
      markupPercent: "10",
    },
  ],
};
