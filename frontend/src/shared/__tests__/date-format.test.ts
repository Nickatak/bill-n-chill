import { describe, expect, it } from "vitest";
import {
  addDaysToDateInput,
  formatDateDisplay,
  formatDateInputFromIso,
  formatDateTimeDisplay,
  futureDateInput,
  todayDateInput,
} from "../date-format";

// ---------------------------------------------------------------------------
// formatDateDisplay
// ---------------------------------------------------------------------------

describe("formatDateDisplay", () => {
  it("formats a YYYY-MM-DD string to en-US short date", () => {
    expect(formatDateDisplay("2024-06-15")).toBe("Jun 15, 2024");
  });

  it("returns 'TBD' for undefined", () => {
    expect(formatDateDisplay(undefined)).toBe("TBD");
  });

  it("returns 'TBD' for null", () => {
    expect(formatDateDisplay(null)).toBe("TBD");
  });

  it("returns 'TBD' for empty string", () => {
    expect(formatDateDisplay("")).toBe("TBD");
  });

  it("returns fallback for invalid date", () => {
    expect(formatDateDisplay("not-a-date")).toBe("TBD");
  });

  it("accepts a custom fallback", () => {
    expect(formatDateDisplay(null, "N/A")).toBe("N/A");
  });

  it("handles Jan 1 (boundary)", () => {
    expect(formatDateDisplay("2025-01-01")).toBe("Jan 1, 2025");
  });

  it("handles Dec 31 (boundary)", () => {
    expect(formatDateDisplay("2025-12-31")).toBe("Dec 31, 2025");
  });
});

// ---------------------------------------------------------------------------
// formatDateTimeDisplay
// ---------------------------------------------------------------------------

describe("formatDateTimeDisplay", () => {
  it("formats a full ISO datetime to en-US date+time", () => {
    const result = formatDateTimeDisplay("2024-06-15T14:30:00Z");
    // Contains date portion — exact time depends on locale/TZ
    expect(result).toContain("Jun");
    expect(result).toContain("15");
    expect(result).toContain("2024");
  });

  it("returns '--' for undefined", () => {
    expect(formatDateTimeDisplay(undefined)).toBe("--");
  });

  it("returns '--' for null", () => {
    expect(formatDateTimeDisplay(null)).toBe("--");
  });

  it("returns '--' for empty string", () => {
    expect(formatDateTimeDisplay("")).toBe("--");
  });

  it("returns fallback for invalid datetime", () => {
    expect(formatDateTimeDisplay("garbage")).toBe("--");
  });

  it("accepts a custom fallback", () => {
    expect(formatDateTimeDisplay(null, "unknown")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// formatDateInputFromIso
// ---------------------------------------------------------------------------

describe("formatDateInputFromIso", () => {
  it("extracts YYYY-MM-DD from full ISO datetime", () => {
    expect(formatDateInputFromIso("2024-06-15T14:30:00Z")).toBe("2024-06-15");
  });

  it("returns empty string for undefined", () => {
    expect(formatDateInputFromIso(undefined)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(formatDateInputFromIso(null)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatDateInputFromIso("")).toBe("");
  });

  it("returns empty string for invalid date", () => {
    expect(formatDateInputFromIso("not-valid")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// todayDateInput
// ---------------------------------------------------------------------------

describe("todayDateInput", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches today's UTC date", () => {
    const expected = new Date().toISOString().slice(0, 10);
    expect(todayDateInput()).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// futureDateInput
// ---------------------------------------------------------------------------

describe("futureDateInput", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(futureDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("defaults to 30 days from now", () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    expect(futureDateInput()).toBe(d.toISOString().slice(0, 10));
  });

  it("accepts a custom day offset", () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    expect(futureDateInput(7)).toBe(d.toISOString().slice(0, 10));
  });
});

// ---------------------------------------------------------------------------
// addDaysToDateInput
// ---------------------------------------------------------------------------

describe("addDaysToDateInput", () => {
  it("adds days to a valid date", () => {
    expect(addDaysToDateInput("2024-06-15", 10)).toBe("2024-06-25");
  });

  it("subtracts days with negative offset", () => {
    expect(addDaysToDateInput("2024-06-15", -5)).toBe("2024-06-10");
  });

  it("crosses month boundary", () => {
    expect(addDaysToDateInput("2024-01-30", 5)).toBe("2024-02-04");
  });

  it("crosses year boundary", () => {
    expect(addDaysToDateInput("2024-12-30", 5)).toBe("2025-01-04");
  });

  it("returns empty string for empty input", () => {
    expect(addDaysToDateInput("", 5)).toBe("");
  });

  it("returns empty string for malformed input", () => {
    expect(addDaysToDateInput("not-a-date", 5)).toBe("");
  });

  it("returns empty string for partial date", () => {
    expect(addDaysToDateInput("2024-06", 5)).toBe("");
  });

  it("handles zero days (identity)", () => {
    expect(addDaysToDateInput("2024-06-15", 0)).toBe("2024-06-15");
  });

  it("handles leap year Feb 29", () => {
    expect(addDaysToDateInput("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("handles non-leap year Feb 28", () => {
    expect(addDaysToDateInput("2025-02-28", 1)).toBe("2025-03-01");
  });
});
