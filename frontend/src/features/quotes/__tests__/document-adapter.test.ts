import { describe, expect, it } from "vitest";
import {
  toQuoteStatusPolicy,
  toQuoteStatusEvents,
  createQuoteDocumentAdapter,
} from "../document-adapter";
import type { CreatorStatusPolicy } from "@/shared/document-creator/types";
import { quoteRecord, formState, policyContract, statusEvents } from "./fixtures";

// ---------------------------------------------------------------------------
// toQuoteStatusPolicy
// ---------------------------------------------------------------------------

describe("toQuoteStatusPolicy", () => {
  it("maps snake_case contract fields to camelCase", () => {
    const result = toQuoteStatusPolicy(policyContract);

    expect(result.statuses).toEqual(policyContract.statuses);
    expect(result.statusLabels).toEqual(policyContract.status_labels);
    expect(result.defaultCreateStatus).toBe("draft");
    expect(result.defaultStatusFilters).toEqual(["draft", "sent"]);
    expect(result.allowedTransitions).toEqual(policyContract.allowed_status_transitions);
    expect(result.terminalStatuses).toEqual(["approved", "rejected"]);
  });
});

// ---------------------------------------------------------------------------
// toQuoteStatusEvents
// ---------------------------------------------------------------------------

describe("toQuoteStatusEvents", () => {
  it("maps snake_case event fields to camelCase", () => {
    const result = toQuoteStatusEvents(statusEvents);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 1,
      fromStatus: null,
      toStatus: "draft",
      note: "Created",
      actorEmail: "alice@example.com",
      occurredAt: "2026-01-15T10:00:00Z",
    });
    expect(result[1]).toEqual({
      id: 2,
      fromStatus: "draft",
      toStatus: "sent",
      note: "Sent to customer",
      actorEmail: "bob@example.com",
      occurredAt: "2026-01-16T14:30:00Z",
    });
  });

  it("returns empty array for empty input", () => {
    expect(toQuoteStatusEvents([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createQuoteDocumentAdapter
// ---------------------------------------------------------------------------

describe("createQuoteDocumentAdapter", () => {
  const policy: CreatorStatusPolicy = toQuoteStatusPolicy(policyContract);
  const adapter: ReturnType<typeof createQuoteDocumentAdapter> = createQuoteDocumentAdapter(policy, statusEvents);

  it("has kind 'quotes'", () => {
    expect(adapter.kind).toBe("quote");
  });

  it("exposes the status policy", () => {
    expect(adapter.statusPolicy).toBe(policy);
  });

  // --- Identity & display ---

  describe("getDocumentId", () => {
    it("returns stringified id for existing document", () => {
      expect(adapter.getDocumentId(quoteRecord)).toBe("42");
    });

    it("returns null for null document", () => {
      expect(adapter.getDocumentId(null as never)).toBeNull();
    });
  });

  describe("getDocumentTitle", () => {
    it("returns the title", () => {
      expect(adapter.getDocumentTitle(quoteRecord)).toBe("Kitchen remodel");
    });

    it("returns fallback for missing document", () => {
      expect(adapter.getDocumentTitle(undefined as never)).toBe("Untitled quote");
    });
  });

  describe("getDocumentStatus", () => {
    it("returns the status", () => {
      expect(adapter.getDocumentStatus(quoteRecord)).toBe("sent");
    });

    it("returns default create status for missing document", () => {
      expect(adapter.getDocumentStatus(undefined as never)).toBe("draft");
    });
  });

  describe("getMetaFields", () => {
    it("returns meta fields for existing document", () => {
      const fields = adapter.getMetaFields(quoteRecord);
      expect(fields).toEqual([
        { key: "version", label: "Version", value: "v2" },
        { key: "valid_through", label: "Valid Through", value: "2026-03-01" },
      ]);
    });

    it("returns draft defaults for null document", () => {
      const fields = adapter.getMetaFields(null as never);
      expect(fields).toEqual([
        { key: "version", label: "Version", value: "v1" },
        { key: "valid_through", label: "Valid Through", value: "Not set" },
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
      expect(lines).toHaveLength(2);
      expect(lines[0]).toEqual({
        localId: 1,
        costCodeId: "10",
        description: "Demo work",
        quantity: "2",
        unit: "day",
        unitPrice: "1500.00",
        markupPercent: "15",
      });
    });
  });

  describe("getTotals", () => {
    it("returns totals from form state", () => {
      expect(adapter.getTotals(formState)).toEqual({
        subtotal: 5000,
        taxPercent: 8.25,
        taxAmount: 412.5,
        total: 5412.5,
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
        title: "Kitchen remodel",
        valid_through: "2026-03-01",
        tax_percent: "8.25",
        contingency_percent: "0",
        overhead_profit_percent: "0",
        insurance_percent: "0",
        notes_text: "",
        line_items: [
          {
            cost_code: 10,
            description: "Demo work",
            quantity: "2",
            unit: "day",
            unit_price: "1500.00",
            markup_percent: "15",
          },
          {
            cost_code: 20,
            description: "Cabinets",
            quantity: "1",
            unit: "lot",
            unit_price: "2000.00",
            markup_percent: "10",
          },
        ],
      });
    });
  });

  describe("toUpdatePayload", () => {
    it("produces same shape as toCreatePayload", () => {
      const create = adapter.toCreatePayload(formState);
      const update = adapter.toUpdatePayload(formState, quoteRecord);
      expect(update).toEqual(create);
    });
  });
});
