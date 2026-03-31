import { describe, expect, it } from "vitest";
import {
  CHANGE_ORDER_STATUS_LABELS_FALLBACK,
  statusLabel,
  quickStatusControlLabel,
  statusEventLabel,
  formatEventDateTime,
  formatApprovedDate,
  eventActorLabel,
  eventActorHref,
  statusEventActionLabel,
  approvalMeta,
  approvedRollingDeltaForQuote,
  originalBudgetTotalForQuote,
  currentApprovedBudgetTotalForQuote,
  lastStatusEventForChangeOrder,
  toLinePayload,
} from "../components/change-orders-display";
import type { AuditEventRecord, ChangeOrderRecord, OriginQuoteRecord } from "../types";

const LABELS = CHANGE_ORDER_STATUS_LABELS_FALLBACK;

function makeEvent(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id: 1,
    event_type: "change_order_updated",
    object_type: "change_order",
    object_id: 10,
    from_status: "draft",
    to_status: "sent",
    note: "",
    created_by: 5,
    created_by_email: null,
    created_by_display: null,
    created_at: "2026-03-15T14:30:00Z",
    ...overrides,
  };
}

function makeCO(overrides: Partial<ChangeOrderRecord> = {}): ChangeOrderRecord {
  return {
    id: 1,
    project: 1,
    title: "CO #1",
    reason: "",
    status: "draft",
    family_key: "abc",
    amount_delta: "500.00",
    days_delta: 0,
    origin_quote: 10,
    line_items: [],
    created_at: "2026-03-15T12:00:00Z",
    updated_at: "2026-03-15T12:00:00Z",
    ...overrides,
  } as ChangeOrderRecord;
}

// ---------------------------------------------------------------------------
// statusLabel
// ---------------------------------------------------------------------------

describe("statusLabel", () => {
  it("returns label from map when present", () => {
    expect(statusLabel("draft", LABELS)).toBe("Draft");
    expect(statusLabel("sent", LABELS)).toBe("Sent");
  });

  it("title-cases unknown statuses with underscore splitting", () => {
    expect(statusLabel("some_new_status", LABELS)).toBe("Some New Status");
  });

  it("handles single-word unknown status", () => {
    expect(statusLabel("custom", LABELS)).toBe("Custom");
  });
});

// ---------------------------------------------------------------------------
// quickStatusControlLabel
// ---------------------------------------------------------------------------

describe("quickStatusControlLabel", () => {
  it("returns 'Send' for 'sent' when current is different", () => {
    expect(quickStatusControlLabel("sent", LABELS, "draft")).toBe("Send");
  });

  it("returns 'Re-send' for 'sent' when current matches", () => {
    expect(quickStatusControlLabel("sent", LABELS, "sent")).toBe("Re-send");
  });

  it("returns 'Void' for void status", () => {
    expect(quickStatusControlLabel("void", LABELS)).toBe("Void");
  });

  it("returns 'Approved' for approved status", () => {
    expect(quickStatusControlLabel("approved", LABELS)).toBe("Approved");
  });

  it("falls back to statusLabel for unknown statuses", () => {
    expect(quickStatusControlLabel("custom_thing", LABELS)).toBe("Custom Thing");
  });
});

// ---------------------------------------------------------------------------
// statusEventLabel
// ---------------------------------------------------------------------------

describe("statusEventLabel", () => {
  it("returns 'Unset' for empty/falsy status", () => {
    expect(statusEventLabel("", LABELS)).toBe("Unset");
  });

  it("delegates to statusLabel for non-empty status", () => {
    expect(statusEventLabel("approved", LABELS)).toBe("Approved");
  });
});

// ---------------------------------------------------------------------------
// formatEventDateTime
// ---------------------------------------------------------------------------

describe("formatEventDateTime", () => {
  it("formats a valid ISO datetime", () => {
    const result = formatEventDateTime("2026-03-15T14:30:00Z");
    // Locale-dependent, but should contain key parts
    expect(result).toContain("Mar");
    expect(result).toContain("15");
    expect(result).toContain("2026");
  });

  it("returns 'unknown' for invalid date", () => {
    expect(formatEventDateTime("not-a-date")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// formatApprovedDate
// ---------------------------------------------------------------------------

describe("formatApprovedDate", () => {
  it("formats a valid date", () => {
    const result = formatApprovedDate("2026-03-15T12:00:00Z");
    expect(result).toContain("Mar");
    expect(result).toContain("2026");
    // Day may vary by timezone; just verify it's a formatted date, not "unknown date"
    expect(result).not.toBe("unknown date");
  });

  it("returns 'unknown date' for null", () => {
    expect(formatApprovedDate(null)).toBe("unknown date");
  });

  it("returns 'unknown date' for invalid date", () => {
    expect(formatApprovedDate("garbage")).toBe("unknown date");
  });
});

// ---------------------------------------------------------------------------
// eventActorLabel
// ---------------------------------------------------------------------------

describe("eventActorLabel", () => {
  it("prefers display name", () => {
    expect(eventActorLabel(makeEvent({ created_by_display: "Jane Doe" }))).toBe("Jane Doe");
  });

  it("falls back to email", () => {
    expect(eventActorLabel(makeEvent({ created_by_email: "jane@test.com" }))).toBe("jane@test.com");
  });

  it("falls back to user ID", () => {
    expect(eventActorLabel(makeEvent({ created_by: 42 }))).toBe("user #42");
  });

  it("returns 'unknown user' when no identifiers", () => {
    expect(eventActorLabel(makeEvent({
      created_by_display: null,
      created_by_email: null,
      created_by: undefined as unknown as number,
    }))).toBe("unknown user");
  });

  it("trims whitespace from display name", () => {
    expect(eventActorLabel(makeEvent({ created_by_display: "  Bob  " }))).toBe("Bob");
  });
});

// ---------------------------------------------------------------------------
// eventActorHref
// ---------------------------------------------------------------------------

describe("eventActorHref", () => {
  it("returns customer link when actor is a customer", () => {
    expect(eventActorHref(makeEvent({ created_by_customer_id: 7 }))).toBe("/customers?customer=7");
  });

  it("returns null when actor is not a customer", () => {
    expect(eventActorHref(makeEvent({ created_by_customer_id: null }))).toBeNull();
  });

  it("returns null for zero/negative customer IDs", () => {
    expect(eventActorHref(makeEvent({ created_by_customer_id: 0 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// statusEventActionLabel
// ---------------------------------------------------------------------------

describe("statusEventActionLabel", () => {
  it("returns 'Created' for initial draft creation", () => {
    expect(statusEventActionLabel(makeEvent({ from_status: "", to_status: "draft" }), LABELS)).toBe("Created");
  });

  it("returns 'Sent' for draft → sent", () => {
    expect(statusEventActionLabel(makeEvent({ from_status: "draft", to_status: "sent" }), LABELS)).toBe("Sent");
  });

  it("returns 'Re-sent' for sent → sent", () => {
    expect(statusEventActionLabel(makeEvent({ from_status: "sent", to_status: "sent" }), LABELS)).toBe("Re-sent");
  });

  it("returns 'Approved' for -> approved", () => {
    expect(statusEventActionLabel(makeEvent({ to_status: "approved" }), LABELS)).toBe("Approved");
  });

  it("returns 'Rejected' for -> rejected", () => {
    expect(statusEventActionLabel(makeEvent({ to_status: "rejected" }), LABELS)).toBe("Rejected");
  });

  it("returns 'Voided' for -> void", () => {
    expect(statusEventActionLabel(makeEvent({ to_status: "void" }), LABELS)).toBe("Voided");
  });

  it("returns 'Notated' for same-status with note", () => {
    expect(statusEventActionLabel(
      makeEvent({ from_status: "draft", to_status: "draft", note: "Added detail" }),
      LABELS,
    )).toBe("Notated");
  });

  it("returns 'Notated' when metadata says notate", () => {
    expect(statusEventActionLabel(
      makeEvent({ metadata_json: { status_action: "notate" } }),
      LABELS,
    )).toBe("Notated");
  });

  it("returns 'Re-sent' when metadata says resend", () => {
    expect(statusEventActionLabel(
      makeEvent({ metadata_json: { status_action: "resend" } }),
      LABELS,
    )).toBe("Re-sent");
  });

  it("returns 'Returned to Draft' for -> draft with prior status", () => {
    expect(statusEventActionLabel(makeEvent({ from_status: "sent", to_status: "draft" }), LABELS)).toBe("Returned to Draft");
  });

  it("falls back to 'From -> To' for unrecognized transitions", () => {
    expect(statusEventActionLabel(
      makeEvent({ from_status: "custom_a", to_status: "custom_b" }),
      LABELS,
    )).toBe("Custom A -> Custom B");
  });
});

// ---------------------------------------------------------------------------
// approvalMeta
// ---------------------------------------------------------------------------

describe("approvalMeta", () => {
  it("includes date and email when both present", () => {
    const est = { approved_at: "2026-03-15T00:00:00Z", approved_by_email: "jane@test.com" } as OriginQuoteRecord;
    const result = approvalMeta(est);
    expect(result).toContain("approved on");
    expect(result).toContain("Mar");
    expect(result).toContain("jane@test.com");
  });

  it("omits email when not present", () => {
    const est = { approved_at: "2026-03-15T00:00:00Z", approved_by_email: null } as OriginQuoteRecord;
    const result = approvalMeta(est);
    expect(result).toContain("approved on");
    expect(result).not.toContain("by");
  });
});

// ---------------------------------------------------------------------------
// Financial helpers
// ---------------------------------------------------------------------------

describe("approvedRollingDeltaForQuote", () => {
  it("sums deltas of approved COs for the given quote", () => {
    const cos = [
      makeCO({ id: 1, origin_quote: 10, status: "approved", amount_delta: "500.00" }),
      makeCO({ id: 2, origin_quote: 10, status: "approved", amount_delta: "-100.00" }),
      makeCO({ id: 3, origin_quote: 10, status: "draft", amount_delta: "999.00" }), // excluded
      makeCO({ id: 4, origin_quote: 20, status: "approved", amount_delta: "300.00" }), // wrong quote
    ];
    expect(approvedRollingDeltaForQuote(10, cos)).toBe("400.00");
  });

  it("returns '0.00' when no approved COs exist", () => {
    expect(approvedRollingDeltaForQuote(10, [])).toBe("0.00");
  });
});

describe("originalBudgetTotalForQuote", () => {
  it("looks up the total from the map", () => {
    expect(originalBudgetTotalForQuote(10, { 10: 5000 })).toBe("5000.00");
  });

  it("returns '0.00' for unknown quote", () => {
    expect(originalBudgetTotalForQuote(99, { 10: 5000 })).toBe("0.00");
  });
});

describe("currentApprovedBudgetTotalForQuote", () => {
  it("adds original total and approved CO deltas", () => {
    const cos = [
      makeCO({ origin_quote: 10, status: "approved", amount_delta: "500.00" }),
    ];
    const result = currentApprovedBudgetTotalForQuote(10, cos, { 10: 5000 });
    expect(result).toBe("5500.00");
  });
});

// ---------------------------------------------------------------------------
// lastStatusEventForChangeOrder
// ---------------------------------------------------------------------------

describe("lastStatusEventForChangeOrder", () => {
  it("returns the most recent status event for the CO", () => {
    const events = [
      makeEvent({ id: 1, object_id: 10, created_at: "2026-03-14T10:00:00Z", from_status: "", to_status: "draft" }),
      makeEvent({ id: 2, object_id: 10, created_at: "2026-03-15T10:00:00Z", from_status: "draft", to_status: "sent" }),
      makeEvent({ id: 3, object_id: 20, created_at: "2026-03-16T10:00:00Z" }), // wrong CO
    ];
    const result = lastStatusEventForChangeOrder(10, events);
    expect(result?.id).toBe(2);
  });

  it("returns null when no matching events", () => {
    expect(lastStatusEventForChangeOrder(99, [])).toBeNull();
  });

  it("excludes events without status fields", () => {
    const events = [
      makeEvent({ id: 1, object_id: 10, from_status: "", to_status: "" }),
    ];
    expect(lastStatusEventForChangeOrder(10, events)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toLinePayload
// ---------------------------------------------------------------------------

describe("toLinePayload", () => {
  it("converts line items to API payload format", () => {
    const lines = [
      { localId: 1, costCodeId: "5", description: "Demo work", adjustmentReason: "Scope change", amountDelta: "500", daysDelta: "3" },
      { localId: 2, costCodeId: "8", description: "Framing", adjustmentReason: "", amountDelta: "200.50", daysDelta: "0" },
    ];
    const result = toLinePayload(lines);
    expect(result).toEqual([
      { cost_code: 5, description: "Demo work", adjustment_reason: "Scope change", amount_delta: "500", days_delta: 3 },
      { cost_code: 8, description: "Framing", adjustment_reason: "", amount_delta: "200.50", days_delta: 0 },
    ]);
  });

  it("filters out lines with empty cost code", () => {
    const lines = [
      { localId: 1, costCodeId: "", description: "Empty", adjustmentReason: "", amountDelta: "0", daysDelta: "0" },
      { localId: 2, costCodeId: "5", description: "Real", adjustmentReason: "", amountDelta: "100", daysDelta: "0" },
    ];
    expect(toLinePayload(lines)).toHaveLength(1);
    expect(toLinePayload(lines)[0].cost_code).toBe(5);
  });

  it("defaults empty amount to '0'", () => {
    const lines = [
      { localId: 1, costCodeId: "1", description: "", adjustmentReason: "", amountDelta: "  ", daysDelta: "" },
    ];
    const result = toLinePayload(lines);
    expect(result[0].amount_delta).toBe("0");
    expect(result[0].days_delta).toBe(0);
  });
});
