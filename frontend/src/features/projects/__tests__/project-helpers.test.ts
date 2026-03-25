import { describe, expect, it } from "vitest";

import type { ProjectRecord } from "../types";
import {
  PROJECT_STATUS_VALUES,
  PROJECT_STATUS_TRANSITIONS,
  DEFAULT_PROJECT_STATUS_FILTERS,
  parseMoneyValue,
  formatCustomerName,
  projectStatusLabel,
  allowedProfileStatuses,
} from "../utils/project-helpers";

// ---------------------------------------------------------------------------
// parseMoneyValue
// ---------------------------------------------------------------------------

describe("parseMoneyValue", () => {
  it("parses a plain decimal string", () => {
    expect(parseMoneyValue("1234.56")).toBe(1234.56);
  });

  it("parses a negative decimal string", () => {
    expect(parseMoneyValue("-50.25")).toBe(-50.25);
  });

  it("strips currency formatting ($1,234.56)", () => {
    expect(parseMoneyValue("$1,234.56")).toBe(1234.56);
  });

  it("returns a finite number unchanged", () => {
    expect(parseMoneyValue(42)).toBe(42);
  });

  it("returns 0 for Infinity", () => {
    expect(parseMoneyValue(Infinity)).toBe(0);
  });

  it("returns 0 for NaN", () => {
    expect(parseMoneyValue(NaN)).toBe(0);
  });

  it('returns 0 for the placeholder "--"', () => {
    expect(parseMoneyValue("--")).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(parseMoneyValue(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(parseMoneyValue(undefined)).toBe(0);
  });

  it("returns 0 for an empty string", () => {
    expect(parseMoneyValue("")).toBe(0);
  });

  it("returns 0 for non-numeric text", () => {
    expect(parseMoneyValue("abc")).toBe(0);
  });

  it("parses zero correctly", () => {
    expect(parseMoneyValue("0")).toBe(0);
    expect(parseMoneyValue(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatCustomerName
// ---------------------------------------------------------------------------

describe("formatCustomerName", () => {
  it("returns the display name when present", () => {
    const project = { customer: 5, customer_display_name: "Jane Doe" } as ProjectRecord;
    expect(formatCustomerName(project)).toBe("Jane Doe");
  });

  it("falls back to Customer #id when display name is empty", () => {
    const project = { customer: 5, customer_display_name: "" } as ProjectRecord;
    expect(formatCustomerName(project)).toBe("Customer #5");
  });

  it("falls back to Customer #id when display name is missing", () => {
    const project = { customer: 12 } as unknown as ProjectRecord;
    expect(formatCustomerName(project)).toBe("Customer #12");
  });
});

// ---------------------------------------------------------------------------
// projectStatusLabel
// ---------------------------------------------------------------------------

describe("projectStatusLabel", () => {
  it('converts "on_hold" to "on hold"', () => {
    expect(projectStatusLabel("on_hold")).toBe("on hold");
  });

  it("returns single-word statuses unchanged", () => {
    expect(projectStatusLabel("active")).toBe("active");
    expect(projectStatusLabel("prospect")).toBe("prospect");
    expect(projectStatusLabel("completed")).toBe("completed");
    expect(projectStatusLabel("cancelled")).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// allowedProfileStatuses
// ---------------------------------------------------------------------------

describe("allowedProfileStatuses", () => {
  it("includes the current status and valid transitions for prospect", () => {
    expect(allowedProfileStatuses("prospect")).toEqual(["prospect", "active", "cancelled"]);
  });

  it("includes the current status and valid transitions for active", () => {
    expect(allowedProfileStatuses("active")).toEqual([
      "active",
      "on_hold",
      "completed",
      "cancelled",
    ]);
  });

  it("includes the current status and valid transitions for on_hold", () => {
    expect(allowedProfileStatuses("on_hold")).toEqual([
      "on_hold",
      "active",
      "completed",
      "cancelled",
    ]);
  });

  it("returns only the current status for terminal states", () => {
    expect(allowedProfileStatuses("completed")).toEqual(["completed"]);
    expect(allowedProfileStatuses("cancelled")).toEqual(["cancelled"]);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("PROJECT_STATUS_VALUES contains all five statuses", () => {
    expect(PROJECT_STATUS_VALUES).toEqual([
      "prospect",
      "active",
      "on_hold",
      "completed",
      "cancelled",
    ]);
  });

  it("DEFAULT_PROJECT_STATUS_FILTERS defaults to active + on_hold + prospect", () => {
    expect(DEFAULT_PROJECT_STATUS_FILTERS).toEqual(["active", "on_hold", "prospect"]);
  });

  it("terminal states have no outbound transitions", () => {
    expect(PROJECT_STATUS_TRANSITIONS.completed).toEqual([]);
    expect(PROJECT_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });

  it("every transition target is a valid status value", () => {
    const valid = new Set(PROJECT_STATUS_VALUES);
    for (const targets of Object.values(PROJECT_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(valid.has(target)).toBe(true);
      }
    }
  });
});
