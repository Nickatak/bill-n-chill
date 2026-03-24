/**
 * Shared test fixtures for the change-orders feature test suite.
 */

import type { ChangeOrderPolicyContract, ChangeOrderRecord } from "../types";
import type { ChangeOrderStatusEvent } from "../document-adapter";

// ---------------------------------------------------------------------------
// Policy contract
// ---------------------------------------------------------------------------

export const policyContract: ChangeOrderPolicyContract = {
  policy_version: "1",
  statuses: ["draft", "pending", "approved", "rejected"],
  status_labels: { draft: "Draft", pending: "Pending", approved: "Approved", rejected: "Rejected" },
  default_create_status: "draft",
  allowed_status_transitions: {
    draft: ["pending"],
    pending: ["approved", "rejected"],
  },
  terminal_statuses: ["approved", "rejected"],
};

// ---------------------------------------------------------------------------
// Status events
// ---------------------------------------------------------------------------

export const statusEvents: ChangeOrderStatusEvent[] = [
  {
    id: 1,
    from_status: null,
    to_status: "draft",
    note: "Created",
    actor_email: "alice@example.com",
    created_at: "2026-01-15T10:00:00Z",
  },
  {
    id: 2,
    from_status: "draft",
    to_status: "pending",
    note: "Submitted for review",
    actor_email: "bob@example.com",
    created_at: "2026-01-16T14:30:00Z",
  },
];

// ---------------------------------------------------------------------------
// Change order record (API shape)
// ---------------------------------------------------------------------------

export const changeOrderRecord: ChangeOrderRecord = {
  id: 10,
  project: 5,
  family_key: "3",
  title: "Add bathroom tile",
  status: "pending",
  amount_delta: "2500.00",
  days_delta: 5,
  reason: "Client requested upgrade",
  terms_text: "",
  sender_name: "",
  sender_address: "",
  sender_logo_url: "",
  origin_estimate: 42,
  origin_estimate_version: 2,
  requested_by: 1,
  requested_by_email: "alice@example.com",
  approved_by: null,
  approved_by_email: null,
  approved_at: null,
  line_items: [],
  line_total_delta: "2500.00",
  created_at: "2026-01-15T10:00:00Z",
  updated_at: "2026-01-16T14:30:00Z",
};

// ---------------------------------------------------------------------------
// Form state (component shape)
// ---------------------------------------------------------------------------

export const formState = {
  title: "Add bathroom tile",
  reason: "Client requested upgrade",
  amountDelta: "2500.00",
  daysDelta: "5",
  lineItems: [
    {
      localId: 1,
      costCodeId: "100",
      description: "Tile installation",
      adjustmentReason: "",
      amountDelta: "2000.00",
      daysDelta: "3",
    },
    {
      localId: 2,
      costCodeId: "50",
      description: "Premium tile upgrade",
      adjustmentReason: "Material upgrade",
      amountDelta: "500.00",
      daysDelta: "2",
    },
  ],
};
