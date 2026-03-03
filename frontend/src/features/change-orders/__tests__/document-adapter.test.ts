import { describe, expect, it } from "vitest";
import {
  toChangeOrderStatusPolicy,
  toChangeOrderStatusEvents,
  createChangeOrderDocumentAdapter,
} from "../document-adapter";
import type { CreatorStatusPolicy } from "@/shared/document-creator/types";
import { changeOrderRecord, formState, policyContract, statusEvents } from "./fixtures";

// ---------------------------------------------------------------------------
// toChangeOrderStatusPolicy
// ---------------------------------------------------------------------------

describe("toChangeOrderStatusPolicy", () => {
  it("maps snake_case contract fields to camelCase", () => {
    const result: CreatorStatusPolicy = toChangeOrderStatusPolicy(policyContract);

    expect(result.statuses).toEqual(policyContract.statuses);
    expect(result.statusLabels).toEqual(policyContract.status_labels);
    expect(result.defaultCreateStatus).toBe("draft");
    expect(result.allowedTransitions).toEqual(policyContract.allowed_status_transitions);
    expect(result.terminalStatuses).toEqual(["approved", "rejected"]);
  });

  it("uses all statuses as default status filters", () => {
    const result: CreatorStatusPolicy = toChangeOrderStatusPolicy(policyContract);
    expect(result.defaultStatusFilters).toEqual(policyContract.statuses);
  });
});

// ---------------------------------------------------------------------------
// toChangeOrderStatusEvents
// ---------------------------------------------------------------------------

describe("toChangeOrderStatusEvents", () => {
  it("maps snake_case event fields to camelCase", () => {
    const result = toChangeOrderStatusEvents(statusEvents);

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
      toStatus: "pending",
      note: "Submitted for review",
      actorEmail: "bob@example.com",
      occurredAt: "2026-01-16T14:30:00Z",
    });
  });

  it("returns empty array for empty input", () => {
    expect(toChangeOrderStatusEvents([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createChangeOrderDocumentAdapter
// ---------------------------------------------------------------------------

describe("createChangeOrderDocumentAdapter", () => {
  const policy: CreatorStatusPolicy = toChangeOrderStatusPolicy(policyContract);
  const adapter: ReturnType<typeof createChangeOrderDocumentAdapter> =
    createChangeOrderDocumentAdapter(policy, statusEvents);

  it("has kind 'change_order'", () => {
    expect(adapter.kind).toBe("change_order");
  });

  it("exposes the status policy", () => {
    expect(adapter.statusPolicy).toBe(policy);
  });

  // --- Identity & display ---

  describe("getDocumentId", () => {
    it("returns stringified id for existing document", () => {
      expect(adapter.getDocumentId(changeOrderRecord)).toBe("10");
    });

    it("returns null for null document", () => {
      expect(adapter.getDocumentId(null as never)).toBeNull();
    });
  });

  describe("getDocumentTitle", () => {
    it("returns the title", () => {
      expect(adapter.getDocumentTitle(changeOrderRecord)).toBe("Add bathroom tile");
    });

    it("returns fallback for missing document", () => {
      expect(adapter.getDocumentTitle(undefined as never)).toBe("Untitled change order");
    });
  });

  describe("getDocumentStatus", () => {
    it("returns the status", () => {
      expect(adapter.getDocumentStatus(changeOrderRecord)).toBe("pending");
    });

    it("returns default create status for missing document", () => {
      expect(adapter.getDocumentStatus(undefined as never)).toBe("draft");
    });
  });

  describe("getMetaFields", () => {
    it("returns meta fields for existing document", () => {
      const fields = adapter.getMetaFields(changeOrderRecord);
      expect(fields).toEqual([
        { key: "co_id", label: "Change Order #", value: "CO-10" },
        { key: "revision", label: "Revision", value: "v2" },
        { key: "origin_estimate", label: "Original Estimate", value: "#42" },
        { key: "line_delta_total", label: "Line Delta Total", value: "$2500.00" },
      ]);
    });

    it("returns draft defaults for null document", () => {
      const fields = adapter.getMetaFields(null as never);
      expect(fields).toEqual([
        { key: "co_id", label: "Change Order #", value: "Draft" },
        { key: "revision", label: "Revision", value: "v1" },
        { key: "origin_estimate", label: "Original Estimate", value: "Not set" },
        { key: "line_delta_total", label: "Line Delta Total", value: "$0.00" },
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
        description: "Tile installation",
        quantity: "1",
        unit: "ea",
        unitPrice: "2000.00",
        amountDelta: "2000.00",
        daysDelta: "3",
      });
    });
  });

  describe("getTotals", () => {
    it("returns totals from form state", () => {
      expect(adapter.getTotals(formState)).toEqual({
        subtotal: 2500,
        total: 2500,
        metadata: { days_delta: 5 },
      });
    });

    it("defaults to 0 when amounts are empty", () => {
      const totals = adapter.getTotals({ ...formState, amountDelta: "", daysDelta: "" });
      expect(totals.subtotal).toBe(0);
      expect(totals.total).toBe(0);
      expect(totals.metadata).toEqual({ days_delta: 0 });
    });
  });

  // --- Form state → API payloads ---

  describe("toCreatePayload", () => {
    it("serializes form state to snake_case API payload", () => {
      const payload = adapter.toCreatePayload(formState);
      expect(payload).toEqual({
        title: "Add bathroom tile",
        reason: "Client requested upgrade",
        amount_delta: "2500.00",
        days_delta: 5,
        line_items: [
          {
            line_type: "scope",
            budget_line: 100,
            description: "Tile installation",
            adjustment_reason: "",
            amount_delta: "2000.00",
            days_delta: 3,
          },
          {
            line_type: "adjustment",
            budget_line: 200,
            description: "Premium tile upgrade",
            adjustment_reason: "Material upgrade",
            amount_delta: "500.00",
            days_delta: 2,
          },
        ],
      });
    });
  });

  describe("toUpdatePayload", () => {
    it("produces same shape as toCreatePayload", () => {
      const create = adapter.toCreatePayload(formState);
      const update = adapter.toUpdatePayload(formState, changeOrderRecord);
      expect(update).toEqual(create);
    });
  });
});
