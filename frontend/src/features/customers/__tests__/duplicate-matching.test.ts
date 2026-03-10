import { describe, expect, it } from "vitest";

import { formatCreatedAt, normalized, matchedFields } from "../utils/duplicate-matching";
import type { CustomerIntakePayload, DuplicateCustomerCandidate } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<DuplicateCustomerCandidate> = {}): DuplicateCustomerCandidate {
  return {
    id: 1,
    display_name: "Jane Doe",
    phone: "5551234567",
    email: "jane@example.com",
    billing_address: "123 Main St",
    created_at: "2026-01-15T10:30:00Z",
    ...overrides,
  };
}

function makePayload(overrides: Partial<CustomerIntakePayload> = {}): CustomerIntakePayload {
  return {
    full_name: "Jane Doe",
    phone: "5551234567",
    email: "jane@example.com",
    project_address: "123 Main St",
    notes: "",
    source: "field_manual",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatCreatedAt
// ---------------------------------------------------------------------------

describe("formatCreatedAt", () => {
  it("formats a valid ISO timestamp", () => {
    const result = formatCreatedAt("2026-01-15T10:30:00Z");
    // toLocaleString output varies by environment; just verify it changed
    expect(result).not.toBe("2026-01-15T10:30:00Z");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns the raw string for an invalid date", () => {
    expect(formatCreatedAt("not-a-date")).toBe("not-a-date");
  });

  it("returns the raw string for an empty string", () => {
    expect(formatCreatedAt("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalized
// ---------------------------------------------------------------------------

describe("normalized", () => {
  it("lowercases and trims", () => {
    expect(normalized("  Hello World  ")).toBe("hello world");
  });

  it("returns empty string for null", () => {
    expect(normalized(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(normalized(undefined)).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalized("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// matchedFields
// ---------------------------------------------------------------------------

describe("matchedFields", () => {
  it("returns empty array when payload is null", () => {
    expect(matchedFields(makeCandidate(), null)).toEqual([]);
  });

  it("matches all four fields when identical", () => {
    const result = matchedFields(makeCandidate(), makePayload());
    expect(result).toEqual(["phone", "email", "name", "address"]);
  });

  it("matches phone only", () => {
    const result = matchedFields(
      makeCandidate(),
      makePayload({ full_name: "Other", email: "other@x.com", project_address: "456 Elm" }),
    );
    expect(result).toEqual(["phone"]);
  });

  it("matches email only", () => {
    const result = matchedFields(
      makeCandidate(),
      makePayload({ full_name: "Other", phone: "9999999999", project_address: "456 Elm" }),
    );
    expect(result).toEqual(["email"]);
  });

  it("matches name only", () => {
    const result = matchedFields(
      makeCandidate(),
      makePayload({ phone: "9999999999", email: "other@x.com", project_address: "456 Elm" }),
    );
    expect(result).toEqual(["name"]);
  });

  it("matches address only", () => {
    const result = matchedFields(
      makeCandidate(),
      makePayload({ full_name: "Other", phone: "9999999999", email: "other@x.com" }),
    );
    expect(result).toEqual(["address"]);
  });

  it("is case-insensitive", () => {
    const result = matchedFields(
      makeCandidate({ display_name: "JANE DOE", email: "JANE@EXAMPLE.COM" }),
      makePayload({ full_name: "jane doe", email: "jane@example.com" }),
    );
    expect(result).toContain("name");
    expect(result).toContain("email");
  });

  it("ignores leading/trailing whitespace", () => {
    const result = matchedFields(
      makeCandidate({ phone: "  5551234567  " }),
      makePayload({ phone: "5551234567" }),
    );
    expect(result).toContain("phone");
  });

  it("skips empty payload fields (does not false-match on empty strings)", () => {
    const result = matchedFields(
      makeCandidate({ phone: "", email: "" }),
      makePayload({ phone: "", email: "" }),
    );
    // Empty fields should NOT be considered a match
    expect(result).not.toContain("phone");
    expect(result).not.toContain("email");
  });

  it("returns empty array when nothing matches", () => {
    const result = matchedFields(
      makeCandidate(),
      makePayload({
        full_name: "Completely Different",
        phone: "0000000000",
        email: "nope@nope.com",
        project_address: "999 Nowhere",
      }),
    );
    expect(result).toEqual([]);
  });
});
