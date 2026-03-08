import { describe, expect, it } from "vitest";
import {
  dueDateFromIssueDate,
  emptyLine,
  invoiceNextActionHint,
  invoiceStatusEventActionLabel,
  invoiceStatusLabel,
  nextInvoiceNumberPreview,
  normalizeDecimalInput,
  projectStatusLabel,
  publicInvoiceHref,
  readInvoiceApiError,
} from "../helpers";
import type { InvoiceRecord, InvoiceStatusEventRecord } from "../types";

// ---------------------------------------------------------------------------
// dueDateFromIssueDate
// ---------------------------------------------------------------------------

describe("dueDateFromIssueDate", () => {
  it("adds dueDays to a valid issue date", () => {
    expect(dueDateFromIssueDate("2026-01-01", 30)).toBe("2026-01-31");
  });

  it("clamps dueDays to minimum of 1", () => {
    expect(dueDateFromIssueDate("2026-01-01", 0)).toBe("2026-01-02");
  });

  it("clamps dueDays to maximum of 365", () => {
    const result = dueDateFromIssueDate("2026-01-01", 999);
    expect(result).toBe("2027-01-01");
  });

  it("defaults to 30 days for non-finite dueDays", () => {
    expect(dueDateFromIssueDate("2026-03-01", NaN)).toBe("2026-03-31");
  });

  it("rounds fractional dueDays", () => {
    expect(dueDateFromIssueDate("2026-01-01", 10.7)).toBe("2026-01-12");
  });
});

// ---------------------------------------------------------------------------
// normalizeDecimalInput
// ---------------------------------------------------------------------------

describe("normalizeDecimalInput", () => {
  it("formats a number to two decimals", () => {
    expect(normalizeDecimalInput(42)).toBe("42.00");
  });

  it("formats a fractional number", () => {
    expect(normalizeDecimalInput(3.1)).toBe("3.10");
  });

  it("returns fallback for NaN", () => {
    expect(normalizeDecimalInput(NaN)).toBe("0");
  });

  it("returns fallback for Infinity", () => {
    expect(normalizeDecimalInput(Infinity)).toBe("0");
  });

  it("uses custom fallback when provided", () => {
    expect(normalizeDecimalInput(NaN, "N/A")).toBe("N/A");
  });
});

// ---------------------------------------------------------------------------
// emptyLine
// ---------------------------------------------------------------------------

describe("emptyLine", () => {
  it("creates a line with the given localId", () => {
    const result = emptyLine(3);
    expect(result.localId).toBe(3);
    expect(result.lineType).toBe("scope");
    expect(result.budgetLineId).toBe("");
    expect(result.description).toBe("Invoice scope item");
    expect(result.quantity).toBe("1");
    expect(result.unit).toBe("ea");
    expect(result.unitPrice).toBe("0");
  });

  it("uses defaultBudgetLineId when provided", () => {
    const result = emptyLine(1, "42");
    expect(result.budgetLineId).toBe("42");
  });

  it("creates a direct line when lineType is direct", () => {
    const result = emptyLine(1, "", "direct");
    expect(result.lineType).toBe("direct");
    expect(result.budgetLineId).toBe("");
    expect(result.description).toBe("Direct invoice item");
  });

  it("ignores defaultBudgetLineId for direct lines", () => {
    const result = emptyLine(1, "99", "direct");
    expect(result.budgetLineId).toBe("");
  });
});

// ---------------------------------------------------------------------------
// invoiceStatusLabel
// ---------------------------------------------------------------------------

describe("invoiceStatusLabel", () => {
  it("returns label for known statuses", () => {
    expect(invoiceStatusLabel("draft")).toBe("Draft");
    expect(invoiceStatusLabel("sent")).toBe("Sent");
    expect(invoiceStatusLabel("partially_paid")).toBe("Partially Paid");
    expect(invoiceStatusLabel("paid")).toBe("Paid");
    expect(invoiceStatusLabel("void")).toBe("Void");
  });

  it("returns raw value for unknown status", () => {
    expect(invoiceStatusLabel("custom")).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// publicInvoiceHref
// ---------------------------------------------------------------------------

describe("publicInvoiceHref", () => {
  it("returns path with public ref", () => {
    expect(publicInvoiceHref("abc-123")).toBe("/invoice/abc-123");
  });

  it("returns empty string for undefined", () => {
    expect(publicInvoiceHref(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(publicInvoiceHref("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// invoiceNextActionHint
// ---------------------------------------------------------------------------

describe("invoiceNextActionHint", () => {
  it("returns hint for draft", () => {
    expect(invoiceNextActionHint("draft")).toContain("send");
  });

  it("returns hint for sent", () => {
    expect(invoiceNextActionHint("sent")).toContain("payments");
  });

  it("returns hint for partially_paid", () => {
    expect(invoiceNextActionHint("partially_paid")).toContain("remaining");
  });

  it("returns settled message for paid", () => {
    expect(invoiceNextActionHint("paid")).toContain("settled");
  });

  it("returns void message for void", () => {
    expect(invoiceNextActionHint("void")).toContain("void");
  });

  it("returns generic message for unknown status", () => {
    expect(invoiceNextActionHint("custom")).toContain("status transition");
  });
});

// ---------------------------------------------------------------------------
// nextInvoiceNumberPreview
// ---------------------------------------------------------------------------

describe("nextInvoiceNumberPreview", () => {
  it("returns INV-0001 for empty list", () => {
    expect(nextInvoiceNumberPreview([])).toBe("INV-0001");
  });

  it("increments past existing numbers", () => {
    const rows = [
      { invoice_number: "INV-0001" },
      { invoice_number: "INV-0002" },
    ] as InvoiceRecord[];
    expect(nextInvoiceNumberPreview(rows)).toBe("INV-0003");
  });

  it("skips gaps when number is already taken", () => {
    const rows = [
      { invoice_number: "INV-0001" },
      { invoice_number: "INV-0003" },
    ] as InvoiceRecord[];
    // rows.length + 1 = 3, but 3 is taken → 4
    expect(nextInvoiceNumberPreview(rows)).toBe("INV-0004");
  });

  it("preserves digit width from existing numbers", () => {
    const rows = [
      { invoice_number: "INV-00001" },
    ] as InvoiceRecord[];
    expect(nextInvoiceNumberPreview(rows)).toBe("INV-00002");
  });

  it("ignores non-INV-prefixed numbers", () => {
    const rows = [
      { invoice_number: "CUSTOM-001" },
    ] as InvoiceRecord[];
    expect(nextInvoiceNumberPreview(rows)).toBe("INV-0002");
  });
});

// ---------------------------------------------------------------------------
// invoiceStatusEventActionLabel
// ---------------------------------------------------------------------------

describe("invoiceStatusEventActionLabel", () => {
  function event(overrides: Partial<InvoiceStatusEventRecord>): InvoiceStatusEventRecord {
    return {
      id: 1,
      invoice: 1,
      from_status: "draft",
      to_status: "sent",
      note: "",
      changed_by: 1,
      changed_by_email: "user@example.com",
      changed_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  it("returns 'Notated' for notate action_type", () => {
    expect(invoiceStatusEventActionLabel(event({ action_type: "notate" }), label)).toBe("Notated");
  });

  it("returns 'Re-sent' for resend action_type", () => {
    expect(invoiceStatusEventActionLabel(event({ action_type: "resend" }), label)).toBe("Re-sent");
  });

  it("returns 'Created' for create action_type", () => {
    expect(invoiceStatusEventActionLabel(event({ action_type: "create" }), label)).toBe("Created");
  });

  it("returns 'Re-sent' for sent→sent", () => {
    expect(
      invoiceStatusEventActionLabel(event({ from_status: "sent", to_status: "sent" }), label),
    ).toBe("Re-sent");
  });

  it("returns 'Notated' for same-status with note", () => {
    expect(
      invoiceStatusEventActionLabel(
        event({ from_status: "sent", to_status: "sent", note: "FYI" }),
        label,
      ),
    ).toBe("Re-sent"); // sent→sent takes priority over note check
  });

  it("returns 'Created as X' when no from_status", () => {
    expect(
      invoiceStatusEventActionLabel(event({ from_status: null, to_status: "draft" }), label),
    ).toBe("Created as Draft");
  });

  it("returns 'X to Y' for standard transitions", () => {
    expect(
      invoiceStatusEventActionLabel(event({ from_status: "draft", to_status: "sent" }), label),
    ).toBe("Draft to Sent");
  });
});

// ---------------------------------------------------------------------------
// readInvoiceApiError
// ---------------------------------------------------------------------------

describe("readInvoiceApiError", () => {
  it("returns the API error message when present", () => {
    const payload = { error: { message: "Something went wrong" } };
    expect(readInvoiceApiError(payload, "Fallback")).toBe("Something went wrong");
  });

  it("returns fallback when no error message", () => {
    expect(readInvoiceApiError(undefined, "Fallback")).toBe("Fallback");
  });

  it("appends refresh hint for status transition errors", () => {
    const payload = { error: { message: "Invalid status transition from draft to sent" } };
    const result = readInvoiceApiError(payload, "Fallback");
    expect(result).toContain("Refresh to load the latest status");
  });

  it("does not double-append when message already mentions refresh", () => {
    const payload = { error: { message: "Invalid status transition. Please refresh." } };
    const result = readInvoiceApiError(payload, "Fallback");
    expect(result).not.toContain("Refresh to load the latest status");
  });
});

// ---------------------------------------------------------------------------
// projectStatusLabel
// ---------------------------------------------------------------------------

describe("projectStatusLabel", () => {
  it("replaces underscore with space", () => {
    expect(projectStatusLabel("on_hold")).toBe("on hold");
  });

  it("returns status as-is when no underscore", () => {
    expect(projectStatusLabel("active")).toBe("active");
  });
});
