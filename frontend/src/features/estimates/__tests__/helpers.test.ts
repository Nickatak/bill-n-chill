import { describe, expect, it } from "vitest";
import {
  emptyLine,
  estimateStatusLabel,
  formatStatusAction,
  isNotatedStatusEvent,
  mapEstimateLineItemsToInputs,
  mapLineCostCodes,
  mapPublicEstimateLineItems,
  normalizeFamilyTitle,
  normalizeEstimatePolicy,
  readEstimateApiError,
  resolveAutoSelectEstimate,
  resolveEstimateValidationDeltaDays,
} from "../helpers";
import type {
  EstimateLineItemRecord,
  EstimatePolicyContract,
  EstimateRecord,
  EstimateStatusEventRecord,
} from "../types";

// ---------------------------------------------------------------------------
// normalizeEstimatePolicy
// ---------------------------------------------------------------------------

const FALLBACKS = {
  statuses: ["draft", "sent", "approved", "rejected", "void", "archived"],
  statusLabels: { draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected", void: "Void", archived: "Archived" },
  defaultStatusFilters: ["draft", "sent", "approved", "rejected"],
  quickActionByStatus: { approved: "change_order" as const, rejected: "revision" as const },
};

function contract(overrides: Partial<EstimatePolicyContract> = {}): EstimatePolicyContract {
  return {
    policy_version: "1",
    statuses: ["draft", "sent", "approved", "rejected", "void", "archived"],
    status_labels: { draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected", void: "Void", archived: "Archived" },
    default_create_status: "draft",
    default_status_filters: ["draft", "sent", "approved", "rejected"],
    allowed_status_transitions: {
      draft: ["sent", "void"],
      sent: ["approved", "rejected"],
      approved: [],
      rejected: ["void"],
      void: [],
      archived: [],
    },
    terminal_statuses: ["void", "archived"],
    quick_action_by_status: { approved: "change_order", rejected: "revision" },
    ...overrides,
  };
}

describe("normalizeEstimatePolicy", () => {
  it("returns null when statuses is empty", () => {
    expect(normalizeEstimatePolicy(contract({ statuses: [] }), FALLBACKS)).toBeNull();
  });

  it("returns null when allowed_status_transitions is missing", () => {
    const c = contract();
    // @ts-expect-error — testing runtime guard
    c.allowed_status_transitions = undefined;
    expect(normalizeEstimatePolicy(c, FALLBACKS)).toBeNull();
  });

  it("normalizes a valid contract", () => {
    const result = normalizeEstimatePolicy(contract(), FALLBACKS);
    expect(result).not.toBeNull();
    expect(result!.statuses).toEqual(["draft", "sent", "approved", "rejected", "void", "archived"]);
    expect(result!.defaultCreateStatus).toBe("draft");
    expect(result!.allowedTransitions.draft).toEqual(["sent", "void"]);
    expect(result!.allowedTransitions.approved).toEqual([]);
  });

  it("coerces missing transition arrays to empty", () => {
    const c = contract({
      allowed_status_transitions: {
        draft: ["sent"],
        sent: null as unknown as string[],
        approved: undefined as unknown as string[],
        rejected: [],
        void: [],
        archived: [],
      },
    });
    const result = normalizeEstimatePolicy(c, FALLBACKS)!;
    expect(result.allowedTransitions.sent).toEqual([]);
    expect(result.allowedTransitions.approved).toEqual([]);
  });

  it("falls back to first status when default_create_status is empty", () => {
    const result = normalizeEstimatePolicy(
      contract({ default_create_status: "" }),
      FALLBACKS,
    )!;
    expect(result.defaultCreateStatus).toBe("draft");
  });

  it("merges status labels with fallbacks", () => {
    const result = normalizeEstimatePolicy(
      contract({ status_labels: { draft: "New" } }),
      FALLBACKS,
    )!;
    expect(result.statusLabels.draft).toBe("New");
    expect(result.statusLabels.sent).toBe("Sent");
  });

  it("merges quick actions with fallbacks", () => {
    const result = normalizeEstimatePolicy(
      contract({ quick_action_by_status: { void: "revision" } }),
      FALLBACKS,
    )!;
    expect(result.quickActionByStatus.void).toBe("revision");
    expect(result.quickActionByStatus.approved).toBe("change_order");
  });

  it("uses fallback filters when contract has none", () => {
    const result = normalizeEstimatePolicy(
      contract({ default_status_filters: [] }),
      FALLBACKS,
    )!;
    expect(result.defaultStatusFilters).toEqual(["draft", "sent", "approved", "rejected"]);
  });

  it("filters out invalid statuses from default_status_filters", () => {
    const result = normalizeEstimatePolicy(
      contract({ default_status_filters: ["draft", "nonexistent", "sent"] }),
      FALLBACKS,
    )!;
    expect(result.defaultStatusFilters).toEqual(["draft", "sent"]);
  });

  it("falls back to all statuses when no filters are valid", () => {
    const result = normalizeEstimatePolicy(
      contract({ default_status_filters: ["nonexistent"] }),
      FALLBACKS,
    )!;
    expect(result.defaultStatusFilters).toEqual(contract().statuses);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoSelectEstimate
// ---------------------------------------------------------------------------

function estimate(overrides: Partial<EstimateRecord>): EstimateRecord {
  return {
    id: 1,
    project: 1,
    version: 1,
    status: "draft",
    title: "Test",
    valid_through: null,
    terms_text: "",
    subtotal: "0",
    tax_percent: "0",
    grand_total: "0",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveAutoSelectEstimate", () => {
  const filters = ["draft", "sent", "approved", "rejected"];

  it("returns null for empty rows", () => {
    expect(resolveAutoSelectEstimate([], filters, {})).toBeNull();
  });

  it("selects preferred estimate when visible", () => {
    const rows = [estimate({ id: 1, status: "sent" }), estimate({ id: 2, status: "draft" })];
    const result = resolveAutoSelectEstimate(rows, filters, { preferredId: 2 });
    expect(result?.id).toBe(2);
  });

  it("skips preferred estimate when not visible", () => {
    const rows = [estimate({ id: 1, status: "sent" }), estimate({ id: 2, status: "archived" })];
    const result = resolveAutoSelectEstimate(rows, filters, { preferredId: 2 });
    expect(result?.id).toBe(1);
  });

  it("falls back to scoped estimate when preferred is missing", () => {
    const rows = [estimate({ id: 1, status: "sent" }), estimate({ id: 3, status: "approved" })];
    const result = resolveAutoSelectEstimate(rows, filters, { preferredId: 99, scopedId: 3 });
    expect(result?.id).toBe(3);
  });

  it("falls back to first visible estimate", () => {
    const rows = [
      estimate({ id: 1, status: "archived" }),
      estimate({ id: 2, status: "void" }),
      estimate({ id: 3, status: "sent" }),
    ];
    const result = resolveAutoSelectEstimate(rows, filters, {});
    expect(result?.id).toBe(3);
  });

  it("returns null when no estimates match active filters", () => {
    const rows = [estimate({ id: 1, status: "archived" }), estimate({ id: 2, status: "void" })];
    const result = resolveAutoSelectEstimate(rows, filters, {});
    expect(result).toBeNull();
  });

  it("respects priority order: preferred > scoped > first", () => {
    const rows = [
      estimate({ id: 1, status: "draft" }),
      estimate({ id: 2, status: "approved" }),
      estimate({ id: 3, status: "sent" }),
    ];
    expect(resolveAutoSelectEstimate(rows, filters, { preferredId: 3, scopedId: 2 })?.id).toBe(3);
    expect(resolveAutoSelectEstimate(rows, filters, { preferredId: 99, scopedId: 3 })?.id).toBe(3);
    expect(resolveAutoSelectEstimate(rows, filters, { preferredId: 99, scopedId: 99 })?.id).toBe(1);
    expect(resolveAutoSelectEstimate(rows, filters, {})?.id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveEstimateValidationDeltaDays
// ---------------------------------------------------------------------------

describe("resolveEstimateValidationDeltaDays", () => {
  it("returns 30 when defaults are undefined", () => {
    expect(resolveEstimateValidationDeltaDays(undefined)).toBe(30);
  });

  it("returns 30 when defaults are null", () => {
    expect(resolveEstimateValidationDeltaDays(null)).toBe(30);
  });

  it("returns 30 for NaN value", () => {
    expect(
      resolveEstimateValidationDeltaDays({ default_estimate_valid_delta: NaN }),
    ).toBe(30);
  });

  it("uses the configured value when valid", () => {
    expect(
      resolveEstimateValidationDeltaDays({ default_estimate_valid_delta: 60 }),
    ).toBe(60);
  });

  it("clamps to minimum of 1", () => {
    expect(
      resolveEstimateValidationDeltaDays({ default_estimate_valid_delta: 0 }),
    ).toBe(1);
    expect(
      resolveEstimateValidationDeltaDays({ default_estimate_valid_delta: -10 }),
    ).toBe(1);
  });

  it("clamps to maximum of 365", () => {
    expect(
      resolveEstimateValidationDeltaDays({ default_estimate_valid_delta: 999 }),
    ).toBe(365);
  });

  it("rounds fractional values", () => {
    expect(
      resolveEstimateValidationDeltaDays({ default_estimate_valid_delta: 30.7 }),
    ).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// emptyLine
// ---------------------------------------------------------------------------

describe("emptyLine", () => {
  it("creates a line with the given localId", () => {
    const line = emptyLine(5);
    expect(line.localId).toBe(5);
    expect(line.costCodeId).toBe("");
    expect(line.description).toBe("Scope item");
    expect(line.quantity).toBe("1");
    expect(line.unit).toBe("ea");
    expect(line.unitCost).toBe("0");
    expect(line.markupPercent).toBe("0");
  });

  it("uses defaultCostCodeId when provided", () => {
    const line = emptyLine(1, "42");
    expect(line.costCodeId).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// mapEstimateLineItemsToInputs
// ---------------------------------------------------------------------------

describe("mapEstimateLineItemsToInputs", () => {
  it("returns a single empty line when items array is empty", () => {
    const result = mapEstimateLineItemsToInputs([]);
    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe(1);
    expect(result[0].description).toBe("Scope item");
  });

  it("returns a single empty line when called with no argument", () => {
    const result = mapEstimateLineItemsToInputs();
    expect(result).toHaveLength(1);
  });

  it("maps API line-item records to form inputs", () => {
    const items: EstimateLineItemRecord[] = [
      {
        id: 10,
        cost_code: 5,
        cost_code_code: "01-100",
        cost_code_name: "Demolition",
        description: "Demo work",
        quantity: "2",
        unit: "day",
        unit_cost: "1500.00",
        markup_percent: "15",
      },
      {
        id: 11,
        cost_code: 8,
        description: "Framing",
        quantity: "40",
        unit: "hr",
        unit_cost: "75.00",
        markup_percent: "10",
      },
    ];

    const result = mapEstimateLineItemsToInputs(items);
    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      localId: 1,
      costCodeId: "5",
      description: "Demo work",
      quantity: "2",
      unit: "day",
      unitCost: "1500.00",
      markupPercent: "15",
    });

    expect(result[1]).toEqual({
      localId: 2,
      costCodeId: "8",
      description: "Framing",
      quantity: "40",
      unit: "hr",
      unitCost: "75.00",
      markupPercent: "10",
    });
  });

  it("defaults unit to 'ea' when empty", () => {
    const items: EstimateLineItemRecord[] = [
      {
        id: 1,
        cost_code: 1,
        description: "Item",
        quantity: "1",
        unit: "",
        unit_cost: "100",
        markup_percent: "0",
      },
    ];
    expect(mapEstimateLineItemsToInputs(items)[0].unit).toBe("ea");
  });
});

// ---------------------------------------------------------------------------
// readEstimateApiError
// ---------------------------------------------------------------------------

describe("readEstimateApiError", () => {
  it("returns the API error message when present", () => {
    const payload = { error: { message: "Something went wrong" } };
    expect(readEstimateApiError(payload, "Fallback")).toBe("Something went wrong");
  });

  it("returns fallback when no error message", () => {
    expect(readEstimateApiError(undefined, "Fallback")).toBe("Fallback");
  });

  it("appends refresh hint for status transition errors", () => {
    const payload = { error: { message: "Invalid status transition from draft to approved" } };
    const result = readEstimateApiError(payload, "Fallback");
    expect(result).toContain("Invalid status transition");
    expect(result).toContain("Refresh to load the latest status");
  });

  it("does not append refresh hint if message already mentions refresh", () => {
    const payload = { error: { message: "Invalid status transition. Please refresh." } };
    const result = readEstimateApiError(payload, "Fallback");
    expect(result).not.toContain("Refresh to load the latest status");
  });

  it("does not append refresh hint for non-transition errors", () => {
    const payload = { error: { message: "Permission denied" } };
    expect(readEstimateApiError(payload, "Fallback")).toBe("Permission denied");
  });
});

// ---------------------------------------------------------------------------
// normalizeFamilyTitle
// ---------------------------------------------------------------------------

describe("normalizeFamilyTitle", () => {
  it("lowercases and trims", () => {
    expect(normalizeFamilyTitle("  Kitchen Remodel  ")).toBe("kitchen remodel");
  });

  it("handles empty string", () => {
    expect(normalizeFamilyTitle("")).toBe("");
  });

  it("handles already-normalized input", () => {
    expect(normalizeFamilyTitle("bathroom")).toBe("bathroom");
  });
});

// ---------------------------------------------------------------------------
// mapPublicEstimateLineItems
// ---------------------------------------------------------------------------

describe("mapPublicEstimateLineItems", () => {
  it("returns empty array for null estimate", () => {
    expect(mapPublicEstimateLineItems(null)).toEqual([]);
  });

  it("returns empty array when estimate has no line items", () => {
    const estimate = { line_items: [] } as unknown as EstimateRecord;
    expect(mapPublicEstimateLineItems(estimate)).toEqual([]);
  });

  it("maps line items from estimate record", () => {
    const estimate = {
      line_items: [
        {
          id: 1,
          cost_code: 5,
          cost_code_code: "01-100",
          cost_code_name: "Demo",
          description: "Demo work",
          quantity: "2",
          unit: "day",
          unit_cost: "500.00",
          markup_percent: "10",
        },
      ],
    } as unknown as EstimateRecord;

    const result = mapPublicEstimateLineItems(estimate);
    expect(result).toHaveLength(1);
    expect(result[0].costCodeId).toBe("5");
    expect(result[0].unitCost).toBe("500.00");
  });
});

// ---------------------------------------------------------------------------
// mapLineCostCodes
// ---------------------------------------------------------------------------

describe("mapLineCostCodes", () => {
  it("returns empty array for null estimate", () => {
    expect(mapLineCostCodes(null)).toEqual([]);
  });

  it("extracts deduplicated cost codes from line items", () => {
    const estimate = {
      line_items: [
        { cost_code: 5, cost_code_code: "01-100", cost_code_name: "Demo" },
        { cost_code: 5, cost_code_code: "01-100", cost_code_name: "Demo" },
        { cost_code: 8, cost_code_code: "02-200", cost_code_name: "Framing" },
      ],
    } as unknown as EstimateRecord;

    const result = mapLineCostCodes(estimate);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 5,
      code: "01-100",
      name: "Demo",
      is_active: true,
    });
    expect(result[1]).toEqual({
      id: 8,
      code: "02-200",
      name: "Framing",
      is_active: true,
    });
  });

  it("uses fallback code when cost_code_code is missing", () => {
    const estimate = {
      line_items: [{ cost_code: 99 }],
    } as unknown as EstimateRecord;

    const result = mapLineCostCodes(estimate);
    expect(result[0].code).toBe("CC-99");
    expect(result[0].name).toBe("Cost code");
  });
});

// ---------------------------------------------------------------------------
// estimateStatusLabel
// ---------------------------------------------------------------------------

describe("estimateStatusLabel", () => {
  it("returns label for known status", () => {
    expect(estimateStatusLabel("draft")).toBe("Draft");
    expect(estimateStatusLabel("approved")).toBe("Approved");
    expect(estimateStatusLabel("void")).toBe("Void");
  });

  it("returns the raw value for unknown status", () => {
    expect(estimateStatusLabel("custom_status")).toBe("custom_status");
  });

  it("returns 'Unknown' for undefined", () => {
    expect(estimateStatusLabel(undefined)).toBe("Unknown");
  });

  it("returns 'Unknown' for empty string", () => {
    expect(estimateStatusLabel("")).toBe("Unknown");
  });

  it("trims whitespace before lookup", () => {
    expect(estimateStatusLabel("  sent  ")).toBe("Sent");
  });
});

// ---------------------------------------------------------------------------
// formatStatusAction
// ---------------------------------------------------------------------------

describe("formatStatusAction", () => {
  function event(overrides: Partial<EstimateStatusEventRecord>): EstimateStatusEventRecord {
    return {
      id: 1,
      from_status: "draft",
      to_status: "sent",
      note: "",
      changed_by_email: "user@example.com",
      changed_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("returns 'Notated' for notate action_type", () => {
    expect(formatStatusAction(event({ action_type: "notate" }))).toBe("Notated");
  });

  it("returns 'Re-sent' for resend action_type", () => {
    expect(formatStatusAction(event({ action_type: "resend" }))).toBe("Re-sent");
  });

  it("returns 'Re-sent' for sent→sent with no note", () => {
    expect(
      formatStatusAction(event({ from_status: "sent", to_status: "sent", note: "" })),
    ).toBe("Re-sent");
  });

  it("returns 'Notated' for same-status transition with a note", () => {
    expect(
      formatStatusAction(event({ from_status: "approved", to_status: "approved", note: "FYI" })),
    ).toBe("Notated");
  });

  it("returns known action label for standard transitions", () => {
    expect(formatStatusAction(event({ to_status: "draft" }))).toBe("Created as Draft");
    expect(formatStatusAction(event({ to_status: "sent" }))).toBe("Sent");
    expect(formatStatusAction(event({ to_status: "approved" }))).toBe("Approved");
    expect(formatStatusAction(event({ to_status: "rejected" }))).toBe("Rejected");
    expect(formatStatusAction(event({ to_status: "void" }))).toBe("Voided");
    expect(formatStatusAction(event({ to_status: "archived" }))).toBe("Archived");
  });

  it("falls back to estimateStatusLabel for unknown status", () => {
    expect(formatStatusAction(event({ to_status: "custom" }))).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// isNotatedStatusEvent
// ---------------------------------------------------------------------------

describe("isNotatedStatusEvent", () => {
  function event(overrides: Partial<EstimateStatusEventRecord>): EstimateStatusEventRecord {
    return {
      id: 1,
      from_status: "draft",
      to_status: "sent",
      note: "",
      changed_by_email: "user@example.com",
      changed_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("returns true for notate action_type", () => {
    expect(isNotatedStatusEvent(event({ action_type: "notate" }))).toBe(true);
  });

  it("returns true for same-status with a note", () => {
    expect(
      isNotatedStatusEvent(event({ from_status: "sent", to_status: "sent", note: "Update" })),
    ).toBe(true);
  });

  it("returns false for same-status with no note", () => {
    expect(
      isNotatedStatusEvent(event({ from_status: "sent", to_status: "sent", note: "" })),
    ).toBe(false);
  });

  it("returns false for a real transition", () => {
    expect(
      isNotatedStatusEvent(event({ from_status: "draft", to_status: "sent", note: "Sending" })),
    ).toBe(false);
  });

  it("returns false for whitespace-only note on same status", () => {
    expect(
      isNotatedStatusEvent(event({ from_status: "sent", to_status: "sent", note: "   " })),
    ).toBe(false);
  });
});
