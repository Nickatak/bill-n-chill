import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl, defaultApiBaseUrl } from "../api";

describe("normalizeApiBaseUrl", () => {
  it("strips trailing slash", () => {
    expect(normalizeApiBaseUrl("http://localhost:8000/api/v1/")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("only strips a single trailing slash", () => {
    expect(normalizeApiBaseUrl("http://localhost:8000/api/v1///")).toBe(
      "http://localhost:8000/api/v1//",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeApiBaseUrl("  http://localhost:8000/api/v1  ")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("handles combined whitespace and trailing slash", () => {
    expect(normalizeApiBaseUrl("  http://localhost:8000/api/v1/ ")).toBe(
      "http://localhost:8000/api/v1",
    );
  });

  it("leaves clean URL unchanged", () => {
    expect(normalizeApiBaseUrl("http://localhost:8000/api/v1")).toBe(
      "http://localhost:8000/api/v1",
    );
  });
});

describe("defaultApiBaseUrl", () => {
  it("is a string", () => {
    expect(typeof defaultApiBaseUrl).toBe("string");
  });
});
