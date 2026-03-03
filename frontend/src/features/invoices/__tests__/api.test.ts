import { describe, expect, it } from "vitest";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";

// ---------------------------------------------------------------------------
// defaultApiBaseUrl
// ---------------------------------------------------------------------------

describe("defaultApiBaseUrl", () => {
  it("is a string", () => {
    expect(typeof defaultApiBaseUrl).toBe("string");
  });

  it("does not end with a trailing slash", () => {
    expect(defaultApiBaseUrl.endsWith("/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeApiBaseUrl
// ---------------------------------------------------------------------------

describe("normalizeApiBaseUrl", () => {
  it("returns the URL unchanged when already clean", () => {
    expect(normalizeApiBaseUrl("http://localhost:8000/api/v1")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("strips a trailing slash", () => {
    expect(normalizeApiBaseUrl("http://localhost:8000/api/v1/")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeApiBaseUrl("  http://localhost:8000/api/v1  ")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("strips trailing slash and trims whitespace together", () => {
    expect(normalizeApiBaseUrl("  http://localhost:8000/api/v1/  ")).toBe(
      "http://localhost:8000/api/v1",
    );
  });
});
