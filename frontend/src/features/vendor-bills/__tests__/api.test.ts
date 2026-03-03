import { describe, expect, it } from "vitest";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";

// ---------------------------------------------------------------------------
// normalizeApiBaseUrl
// ---------------------------------------------------------------------------

describe("normalizeApiBaseUrl", () => {
  it("strips trailing slash", () => {
    expect(normalizeApiBaseUrl("http://localhost:8000/api/v1/")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeApiBaseUrl("  http://localhost:8000/api/v1  ")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("handles already-clean URL", () => {
    expect(normalizeApiBaseUrl("http://localhost:8000/api/v1")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("handles both whitespace and trailing slash", () => {
    expect(normalizeApiBaseUrl("  http://localhost:8000/  ")).toBe(
      "http://localhost:8000",
    );
  });
});

// ---------------------------------------------------------------------------
// defaultApiBaseUrl
// ---------------------------------------------------------------------------

describe("defaultApiBaseUrl", () => {
  it("is a non-empty string", () => {
    expect(typeof defaultApiBaseUrl).toBe("string");
    expect(defaultApiBaseUrl.length).toBeGreaterThan(0);
  });

  it("does not end with a trailing slash", () => {
    expect(defaultApiBaseUrl.endsWith("/")).toBe(false);
  });
});
