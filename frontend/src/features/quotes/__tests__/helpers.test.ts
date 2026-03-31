import { describe, expect, it } from "vitest";
import {
  computeQuoteStatusCounts,
  computeLineTotal,
  emptyLine,
  quoteStatusLabel,
  filterVisibleFamilies,
  formatStatusAction,
  groupQuoteFamilies,
  isNotatedStatusEvent,
  mapQuoteLineItemsToInputs,
  mapLineCostCodes,
  mapPublicQuoteLineItems,
  normalizeFamilyTitle,
  normalizeQuotePolicy,
  readQuoteApiError,
  resolveAutoSelectQuote,
  resolveQuoteValidationDeltaDays,
  toNumber,
} from "../helpers";
import type { QuoteLineInput } from "../types";
import type {
  QuoteLineItemRecord,
  QuotePolicyContract,
  QuoteRecord,
  QuoteStatusEventRecord,
} from "../types";

// ---------------------------------------------------------------------------
// normalizeQuotePolicy
// ---------------------------------------------------------------------------

const FALLBACKS = {
  statuses: ["draft", "sent", "approved", "rejected", "void", "archived"],
  statusLabels: { draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected", void: "Void", archived: "Archived" },
  defaultStatusFilters: ["draft", "sent", "approved", "rejected"],
  quickActionByStatus: { approved: "change_order" as const, rejected: "revision" as const },
};

function contract(overrides: Partial<QuotePolicyContract> = {}): QuotePolicyContract {
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

describe("normalizeQuotePolicy", () => {
  it("returns null when statuses is empty", () => {
    expect(normalizeQuotePolicy(contract({ statuses: [] }), FALLBACKS)).toBeNull();
  });

  it("returns null when allowed_status_transitions is missing", () => {
    const c = contract();
    // @ts-expect-error — testing runtime guard
    c.allowed_status_transitions = undefined;
    expect(normalizeQuotePolicy(c, FALLBACKS)).toBeNull();
  });

  it("normalizes a valid contract", () => {
    const result = normalizeQuotePolicy(contract(), FALLBACKS);
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
    const result = normalizeQuotePolicy(c, FALLBACKS)!;
    expect(result.allowedTransitions.sent).toEqual([]);
    expect(result.allowedTransitions.approved).toEqual([]);
  });

  it("falls back to first status when default_create_status is empty", () => {
    const result = normalizeQuotePolicy(
      contract({ default_create_status: "" }),
      FALLBACKS,
    )!;
    expect(result.defaultCreateStatus).toBe("draft");
  });

  it("merges status labels with fallbacks", () => {
    const result = normalizeQuotePolicy(
      contract({ status_labels: { draft: "New" } }),
      FALLBACKS,
    )!;
    expect(result.statusLabels.draft).toBe("New");
    expect(result.statusLabels.sent).toBe("Sent");
  });

  it("merges quick actions with fallbacks", () => {
    const result = normalizeQuotePolicy(
      contract({ quick_action_by_status: { void: "revision" } }),
      FALLBACKS,
    )!;
    expect(result.quickActionByStatus.void).toBe("revision");
    expect(result.quickActionByStatus.approved).toBe("change_order");
  });

  it("uses fallback filters when contract has none", () => {
    const result = normalizeQuotePolicy(
      contract({ default_status_filters: [] }),
      FALLBACKS,
    )!;
    expect(result.defaultStatusFilters).toEqual(["draft", "sent", "approved", "rejected"]);
  });

  it("filters out invalid statuses from default_status_filters", () => {
    const result = normalizeQuotePolicy(
      contract({ default_status_filters: ["draft", "nonexistent", "sent"] }),
      FALLBACKS,
    )!;
    expect(result.defaultStatusFilters).toEqual(["draft", "sent"]);
  });

  it("falls back to all statuses when no filters are valid", () => {
    const result = normalizeQuotePolicy(
      contract({ default_status_filters: ["nonexistent"] }),
      FALLBACKS,
    )!;
    expect(result.defaultStatusFilters).toEqual(contract().statuses);
  });
});

// ---------------------------------------------------------------------------
// resolveAutoSelectQuote
// ---------------------------------------------------------------------------

function quote(overrides: Partial<QuoteRecord>): QuoteRecord {
  return {
    id: 1,
    project: 1,
    version: 1,
    status: "draft",
    title: "Test",
    valid_through: null,
    terms_text: "",
    notes_text: "",
    sender_name: "",
    sender_address: "",
    sender_logo_url: "",
    subtotal: "0",
    tax_percent: "0",
    contingency_percent: "0",
    contingency_total: "0",
    overhead_profit_percent: "0",
    overhead_profit_total: "0",
    insurance_percent: "0",
    insurance_total: "0",
    grand_total: "0",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("resolveAutoSelectQuote", () => {
  const filters = ["draft", "sent", "approved", "rejected"];

  it("returns null for empty rows", () => {
    expect(resolveAutoSelectQuote([], filters, {})).toBeNull();
  });

  it("selects preferred quote when visible", () => {
    const rows = [quote({ id: 1, status: "sent" }), quote({ id: 2, status: "draft" })];
    const result = resolveAutoSelectQuote(rows, filters, { preferredId: 2 });
    expect(result?.id).toBe(2);
  });

  it("skips preferred quote when not visible", () => {
    const rows = [quote({ id: 1, status: "sent" }), quote({ id: 2, status: "archived" })];
    const result = resolveAutoSelectQuote(rows, filters, { preferredId: 2 });
    expect(result?.id).toBe(1);
  });

  it("falls back to scoped quote when preferred is missing", () => {
    const rows = [quote({ id: 1, status: "sent" }), quote({ id: 3, status: "approved" })];
    const result = resolveAutoSelectQuote(rows, filters, { preferredId: 99, scopedId: 3 });
    expect(result?.id).toBe(3);
  });

  it("falls back to first visible quote", () => {
    const rows = [
      quote({ id: 1, status: "archived" }),
      quote({ id: 2, status: "void" }),
      quote({ id: 3, status: "sent" }),
    ];
    const result = resolveAutoSelectQuote(rows, filters, {});
    expect(result?.id).toBe(3);
  });

  it("returns null when no quotes match active filters", () => {
    const rows = [quote({ id: 1, status: "archived" }), quote({ id: 2, status: "void" })];
    const result = resolveAutoSelectQuote(rows, filters, {});
    expect(result).toBeNull();
  });

  it("respects priority order: preferred > scoped > first", () => {
    const rows = [
      quote({ id: 1, status: "draft" }),
      quote({ id: 2, status: "approved" }),
      quote({ id: 3, status: "sent" }),
    ];
    expect(resolveAutoSelectQuote(rows, filters, { preferredId: 3, scopedId: 2 })?.id).toBe(3);
    expect(resolveAutoSelectQuote(rows, filters, { preferredId: 99, scopedId: 3 })?.id).toBe(3);
    expect(resolveAutoSelectQuote(rows, filters, { preferredId: 99, scopedId: 99 })?.id).toBe(1);
    expect(resolveAutoSelectQuote(rows, filters, {})?.id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveQuoteValidationDeltaDays
// ---------------------------------------------------------------------------

describe("resolveQuoteValidationDeltaDays", () => {
  it("returns 30 when defaults are undefined", () => {
    expect(resolveQuoteValidationDeltaDays(undefined)).toBe(30);
  });

  it("returns 30 when defaults are null", () => {
    expect(resolveQuoteValidationDeltaDays(null)).toBe(30);
  });

  it("returns 30 for NaN value", () => {
    expect(
      resolveQuoteValidationDeltaDays({ default_quote_valid_delta: NaN }),
    ).toBe(30);
  });

  it("uses the configured value when valid", () => {
    expect(
      resolveQuoteValidationDeltaDays({ default_quote_valid_delta: 60 }),
    ).toBe(60);
  });

  it("clamps to minimum of 1", () => {
    expect(
      resolveQuoteValidationDeltaDays({ default_quote_valid_delta: 0 }),
    ).toBe(1);
    expect(
      resolveQuoteValidationDeltaDays({ default_quote_valid_delta: -10 }),
    ).toBe(1);
  });

  it("clamps to maximum of 365", () => {
    expect(
      resolveQuoteValidationDeltaDays({ default_quote_valid_delta: 999 }),
    ).toBe(365);
  });

  it("rounds fractional values", () => {
    expect(
      resolveQuoteValidationDeltaDays({ default_quote_valid_delta: 30.7 }),
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
// mapQuoteLineItemsToInputs
// ---------------------------------------------------------------------------

describe("mapQuoteLineItemsToInputs", () => {
  it("returns a single empty line when items array is empty", () => {
    const result = mapQuoteLineItemsToInputs([]);
    expect(result).toHaveLength(1);
    expect(result[0].localId).toBe(1);
    expect(result[0].description).toBe("Scope item");
  });

  it("returns a single empty line when called with no argument", () => {
    const result = mapQuoteLineItemsToInputs();
    expect(result).toHaveLength(1);
  });

  it("maps API line-item records to form inputs", () => {
    const items: QuoteLineItemRecord[] = [
      {
        id: 10,
        cost_code: 5,
        cost_code_code: "01-100",
        cost_code_name: "Demolition",
        description: "Demo work",
        quantity: "2",
        unit: "day",
        unit_price: "1500.00",
        markup_percent: "15",
      },
      {
        id: 11,
        cost_code: 8,
        description: "Framing",
        quantity: "40",
        unit: "hr",
        unit_price: "75.00",
        markup_percent: "10",
      },
    ];

    const result = mapQuoteLineItemsToInputs(items);
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
    const items: QuoteLineItemRecord[] = [
      {
        id: 1,
        cost_code: 1,
        description: "Item",
        quantity: "1",
        unit: "",
        unit_price: "100",
        markup_percent: "0",
      },
    ];
    expect(mapQuoteLineItemsToInputs(items)[0].unit).toBe("ea");
  });
});

// ---------------------------------------------------------------------------
// readQuoteApiError
// ---------------------------------------------------------------------------

describe("readQuoteApiError", () => {
  it("returns the API error message when present", () => {
    const payload = { error: { message: "Something went wrong" } };
    expect(readQuoteApiError(payload, "Fallback")).toBe("Something went wrong");
  });

  it("returns fallback when no error message", () => {
    expect(readQuoteApiError(undefined, "Fallback")).toBe("Fallback");
  });

  it("appends refresh hint for status transition errors", () => {
    const payload = { error: { message: "Invalid status transition from draft to approved" } };
    const result = readQuoteApiError(payload, "Fallback");
    expect(result).toContain("Invalid status transition");
    expect(result).toContain("Refresh to load the latest status");
  });

  it("does not append refresh hint if message already mentions refresh", () => {
    const payload = { error: { message: "Invalid status transition. Please refresh." } };
    const result = readQuoteApiError(payload, "Fallback");
    expect(result).not.toContain("Refresh to load the latest status");
  });

  it("does not append refresh hint for non-transition errors", () => {
    const payload = { error: { message: "Permission denied" } };
    expect(readQuoteApiError(payload, "Fallback")).toBe("Permission denied");
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
// mapPublicQuoteLineItems
// ---------------------------------------------------------------------------

describe("mapPublicQuoteLineItems", () => {
  it("returns empty array for null quote", () => {
    expect(mapPublicQuoteLineItems(null)).toEqual([]);
  });

  it("returns empty array when quote has no line items", () => {
    const quote = { line_items: [] } as unknown as QuoteRecord;
    expect(mapPublicQuoteLineItems(quote)).toEqual([]);
  });

  it("maps line items from quote record", () => {
    const quote = {
      line_items: [
        {
          id: 1,
          cost_code: 5,
          cost_code_code: "01-100",
          cost_code_name: "Demo",
          description: "Demo work",
          quantity: "2",
          unit: "day",
          unit_price: "500.00",
          markup_percent: "10",
        },
      ],
    } as unknown as QuoteRecord;

    const result = mapPublicQuoteLineItems(quote);
    expect(result).toHaveLength(1);
    expect(result[0].costCodeId).toBe("5");
    expect(result[0].unitCost).toBe("500.00");
  });
});

// ---------------------------------------------------------------------------
// mapLineCostCodes
// ---------------------------------------------------------------------------

describe("mapLineCostCodes", () => {
  it("returns empty array for null quote", () => {
    expect(mapLineCostCodes(null)).toEqual([]);
  });

  it("extracts deduplicated cost codes from line items", () => {
    const quote = {
      line_items: [
        { cost_code: 5, cost_code_code: "01-100", cost_code_name: "Demo" },
        { cost_code: 5, cost_code_code: "01-100", cost_code_name: "Demo" },
        { cost_code: 8, cost_code_code: "02-200", cost_code_name: "Framing" },
      ],
    } as unknown as QuoteRecord;

    const result = mapLineCostCodes(quote);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 5,
      code: "01-100",
      name: "Demo",
      is_active: true,
      taxable: true,
    });
    expect(result[1]).toEqual({
      id: 8,
      code: "02-200",
      name: "Framing",
      is_active: true,
      taxable: true,
    });
  });

  it("uses fallback code when cost_code_code is missing", () => {
    const quote = {
      line_items: [{ cost_code: 99 }],
    } as unknown as QuoteRecord;

    const result = mapLineCostCodes(quote);
    expect(result[0].code).toBe("CC-99");
    expect(result[0].name).toBe("Cost code");
  });
});

// ---------------------------------------------------------------------------
// quoteStatusLabel
// ---------------------------------------------------------------------------

describe("quoteStatusLabel", () => {
  it("returns label for known status", () => {
    expect(quoteStatusLabel("draft")).toBe("Draft");
    expect(quoteStatusLabel("approved")).toBe("Approved");
    expect(quoteStatusLabel("void")).toBe("Void");
  });

  it("returns the raw value for unknown status", () => {
    expect(quoteStatusLabel("custom_status")).toBe("custom_status");
  });

  it("returns 'Unknown' for undefined", () => {
    expect(quoteStatusLabel(undefined)).toBe("Unknown");
  });

  it("returns 'Unknown' for empty string", () => {
    expect(quoteStatusLabel("")).toBe("Unknown");
  });

  it("trims whitespace before lookup", () => {
    expect(quoteStatusLabel("  sent  ")).toBe("Sent");
  });
});

// ---------------------------------------------------------------------------
// formatStatusAction
// ---------------------------------------------------------------------------

describe("formatStatusAction", () => {
  function event(overrides: Partial<QuoteStatusEventRecord>): QuoteStatusEventRecord {
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

  it("falls back to quoteStatusLabel for unknown status", () => {
    expect(formatStatusAction(event({ to_status: "custom" }))).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// isNotatedStatusEvent
// ---------------------------------------------------------------------------

describe("isNotatedStatusEvent", () => {
  function event(overrides: Partial<QuoteStatusEventRecord>): QuoteStatusEventRecord {
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

// ---------------------------------------------------------------------------
// toNumber
// ---------------------------------------------------------------------------

describe("toNumber", () => {
  it("parses a valid number string", () => {
    expect(toNumber("42")).toBe(42);
    expect(toNumber("3.14")).toBe(3.14);
  });

  it("returns 0 for empty string", () => {
    expect(toNumber("")).toBe(0);
  });

  it("returns 0 for non-numeric string", () => {
    expect(toNumber("abc")).toBe(0);
  });

  it("returns 0 for NaN-producing input", () => {
    expect(toNumber("NaN")).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(toNumber("Infinity")).toBe(0);
  });

  it("handles negative numbers", () => {
    expect(toNumber("-10")).toBe(-10);
  });
});

// ---------------------------------------------------------------------------
// computeLineTotal
// ---------------------------------------------------------------------------

describe("computeLineTotal", () => {
  function line(overrides: Partial<QuoteLineInput> = {}): QuoteLineInput {
    return {
      localId: 1,
      costCodeId: "1",
      description: "Test",
      quantity: "1",
      unit: "ea",
      unitCost: "100",
      markupPercent: "0",
      ...overrides,
    };
  }

  it("computes base total without markup", () => {
    expect(computeLineTotal(line({ quantity: "2", unitCost: "50" }))).toBe(100);
  });

  it("applies markup percent", () => {
    expect(computeLineTotal(line({ quantity: "1", unitCost: "100", markupPercent: "10" }))).toBe(110);
  });

  it("handles zero quantity", () => {
    expect(computeLineTotal(line({ quantity: "0", unitCost: "100" }))).toBe(0);
  });

  it("handles non-numeric values as 0", () => {
    expect(computeLineTotal(line({ quantity: "abc", unitCost: "100" }))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// groupQuoteFamilies
// ---------------------------------------------------------------------------

describe("groupQuoteFamilies", () => {
  function quote(overrides: Partial<QuoteRecord>): QuoteRecord {
    return {
      id: 1,
      title: "Kitchen",
      version: 1,
      status: "draft",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    } as QuoteRecord;
  }

  it("groups quotes by title", () => {
    const quotes = [
      quote({ id: 1, title: "Kitchen", version: 1 }),
      quote({ id: 2, title: "Kitchen", version: 2 }),
      quote({ id: 3, title: "Bathroom", version: 1 }),
    ];
    const families = groupQuoteFamilies(quotes);
    expect(families).toHaveLength(2);
    const kitchen = families.find((f) => f.title === "Kitchen");
    expect(kitchen?.items).toHaveLength(2);
    expect(kitchen?.items[0].version).toBe(1);
    expect(kitchen?.items[1].version).toBe(2);
  });

  it("sorts versions ascending within a family", () => {
    const quotes = [
      quote({ id: 2, title: "Kitchen", version: 3 }),
      quote({ id: 1, title: "Kitchen", version: 1 }),
      quote({ id: 3, title: "Kitchen", version: 2 }),
    ];
    const families = groupQuoteFamilies(quotes);
    expect(families[0].items.map((e) => e.version)).toEqual([1, 2, 3]);
  });

  it("uses 'Untitled' for empty title", () => {
    const quotes = [quote({ id: 1, title: "" })];
    const families = groupQuoteFamilies(quotes);
    expect(families[0].title).toBe("Untitled");
  });

  it("returns empty array for no quotes", () => {
    expect(groupQuoteFamilies([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeQuoteStatusCounts
// ---------------------------------------------------------------------------

describe("computeQuoteStatusCounts", () => {
  it("counts latest version status per family", () => {
    const families = [
      { title: "A", items: [{ status: "draft" }, { status: "sent" }] as QuoteRecord[] },
      { title: "B", items: [{ status: "approved" }] as QuoteRecord[] },
      { title: "C", items: [{ status: "sent" }] as QuoteRecord[] },
    ];
    const counts = computeQuoteStatusCounts(families);
    expect(counts).toEqual({ sent: 2, approved: 1 });
  });

  it("returns empty object for no families", () => {
    expect(computeQuoteStatusCounts([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// filterVisibleFamilies
// ---------------------------------------------------------------------------

describe("filterVisibleFamilies", () => {
  const families = [
    { title: "A", items: [{ status: "draft" }] as QuoteRecord[] },
    { title: "B", items: [{ status: "sent" }] as QuoteRecord[] },
    { title: "C", items: [{ status: "approved" }] as QuoteRecord[] },
  ];

  it("filters by latest status matching filter set", () => {
    const result = filterVisibleFamilies(families, ["draft", "sent"]);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.title)).toEqual(["A", "B"]);
  });

  it("returns empty array when filters are empty", () => {
    expect(filterVisibleFamilies(families, [])).toEqual([]);
  });

  it("returns all families when all statuses are in filter", () => {
    expect(filterVisibleFamilies(families, ["draft", "sent", "approved"])).toHaveLength(3);
  });
});
