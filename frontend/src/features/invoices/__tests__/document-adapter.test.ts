import { describe, expect, it } from "vitest";
import {
  toInvoiceStatusPolicy,
  toInvoiceStatusEvents,
  createInvoiceDocumentAdapter,
} from "../document-adapter";
import type { CreatorStatusPolicy } from "@/shared/document-creator/types";
import { formState, invoiceRecord, policyContract, statusEvents } from "./fixtures";

// ---------------------------------------------------------------------------
// toInvoiceStatusPolicy
// ---------------------------------------------------------------------------

describe("toInvoiceStatusPolicy", () => {
  it("maps snake_case contract fields to camelCase", () => {
    const result: CreatorStatusPolicy = toInvoiceStatusPolicy(policyContract);

    expect(result.statuses).toEqual(policyContract.statuses);
    expect(result.statusLabels).toEqual(policyContract.status_labels);
    expect(result.defaultCreateStatus).toBe("draft");
    expect(result.defaultStatusFilters).toEqual(["draft", "sent", "outstanding"]);
    expect(result.allowedTransitions).toEqual(policyContract.allowed_status_transitions);
    expect(result.terminalStatuses).toEqual(["closed", "void"]);
  });
});

// ---------------------------------------------------------------------------
// toInvoiceStatusEvents
// ---------------------------------------------------------------------------

describe("toInvoiceStatusEvents", () => {
  it("maps snake_case event fields to camelCase", () => {
    const result = toInvoiceStatusEvents(statusEvents);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 1,
      fromStatus: null,
      toStatus: "draft",
      note: "Created",
      actorEmail: "alice@example.com",
      occurredAt: "2026-02-01T09:00:00Z",
    });
    expect(result[1]).toEqual({
      id: 2,
      fromStatus: "draft",
      toStatus: "sent",
      note: "Sent to customer",
      actorEmail: "bob@example.com",
      occurredAt: "2026-02-05T14:00:00Z",
    });
  });

  it("returns empty array for empty input", () => {
    expect(toInvoiceStatusEvents([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createInvoiceDocumentAdapter
// ---------------------------------------------------------------------------

describe("createInvoiceDocumentAdapter", () => {
  const policy: CreatorStatusPolicy = toInvoiceStatusPolicy(policyContract);
  const adapter: ReturnType<typeof createInvoiceDocumentAdapter> =
    createInvoiceDocumentAdapter(policy, statusEvents);

  it("has kind 'invoice'", () => {
    expect(adapter.kind).toBe("invoice");
  });

  it("exposes the status policy", () => {
    expect(adapter.statusPolicy).toBe(policy);
  });

  // --- Identity & display ---

  describe("getDocumentId", () => {
    it("returns stringified id for existing document", () => {
      expect(adapter.getDocumentId(invoiceRecord)).toBe("20");
    });

    it("returns null for null document", () => {
      expect(adapter.getDocumentId(null as never)).toBeNull();
    });
  });

  describe("getDocumentTitle", () => {
    it("returns the invoice number", () => {
      expect(adapter.getDocumentTitle(invoiceRecord)).toBe("INV-0020");
    });

    it("returns fallback for missing document", () => {
      expect(adapter.getDocumentTitle(undefined as never)).toBe("Draft invoice");
    });
  });

  describe("getDocumentStatus", () => {
    it("returns the status", () => {
      expect(adapter.getDocumentStatus(invoiceRecord)).toBe("sent");
    });

    it("returns default create status for missing document", () => {
      expect(adapter.getDocumentStatus(undefined as never)).toBe("draft");
    });
  });

  describe("getMetaFields", () => {
    it("returns meta fields for existing document", () => {
      const fields = adapter.getMetaFields(invoiceRecord);
      expect(fields).toEqual([
        { key: "invoice_no", label: "Invoice #", value: "INV-0020" },
        { key: "issue_date", label: "Issue Date", value: "2026-02-01" },
        { key: "due_date", label: "Due Date", value: "2026-03-03" },
        { key: "balance_due", label: "Balance Due", value: "$3247.50" },
      ]);
    });

    it("returns draft defaults for null document", () => {
      const fields = adapter.getMetaFields(null as never);
      expect(fields).toEqual([
        { key: "invoice_no", label: "Invoice #", value: "Draft" },
        { key: "issue_date", label: "Issue Date", value: "Not set" },
        { key: "due_date", label: "Due Date", value: "Not set" },
        { key: "balance_due", label: "Balance Due", value: "$0.00" },
      ]);
    });
  });

  describe("getStatusEvents", () => {
    it("returns converted status events", () => {
      const events = adapter.getStatusEvents(null);
      expect(events).toHaveLength(2);
      expect(events[0].toStatus).toBe("draft");
      expect(events[1].actorEmail).toBe("bob@example.com");
    });
  });

  // --- Form state → creator lines / totals ---

  describe("getDraftLines", () => {
    it("maps line items to creator line drafts", () => {
      const lines = adapter.getDraftLines(formState);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        localId: 1,
        description: "Foundation work",
        quantity: "1",
        unit: "lot",
        unitPrice: "3000.00",
      });
    });
  });

  describe("getTotals", () => {
    it("returns totals from form state", () => {
      expect(adapter.getTotals(formState)).toEqual({
        subtotal: 3000,
        taxPercent: 8.25,
        taxAmount: 247.5,
        total: 3247.5,
      });
    });

    it("defaults taxPercent to 0 when empty string", () => {
      const totals = adapter.getTotals({ ...formState, taxPercent: "" });
      expect(totals.taxPercent).toBe(0);
    });
  });

  // --- Form state → API payloads ---

  describe("toCreatePayload", () => {
    it("serializes form state to snake_case API payload", () => {
      const payload = adapter.toCreatePayload(formState);
      expect(payload).toEqual({
        issue_date: "2026-02-01",
        due_date: "2026-03-03",
        tax_percent: "8.25",
        terms_text: "Net 30",
        line_items: [
          {
            cost_code: 50,
            description: "Foundation work",
            quantity: "1",
            unit: "lot",
            unit_price: "3000.00",
          },
        ],
      });
    });
  });

  describe("toUpdatePayload", () => {
    it("produces same shape as toCreatePayload", () => {
      const create = adapter.toCreatePayload(formState);
      const update = adapter.toUpdatePayload(formState, invoiceRecord);
      expect(update).toEqual(create);
    });
  });
});
