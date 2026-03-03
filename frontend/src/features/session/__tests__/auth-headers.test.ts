import { describe, expect, it, vi } from "vitest";

vi.mock("../client-session", () => ({
  loadClientSession: () => null,
}));

import { buildAuthHeaders } from "../auth-headers";

// ---------------------------------------------------------------------------
// buildAuthHeaders
// ---------------------------------------------------------------------------

describe("buildAuthHeaders", () => {
  it("sets Authorization header with token", () => {
    const headers = new Headers(buildAuthHeaders("abc123"));
    expect(headers.get("Authorization")).toBe("Token abc123");
  });

  it("sets Content-Type when specified", () => {
    const headers = new Headers(
      buildAuthHeaders("abc123", { contentType: "application/json" }),
    );
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("appends contentType even when caller headers include Content-Type (case mismatch)", () => {
    // Headers.entries() lowercases keys, so the guard `!nextHeaders["Content-Type"]`
    // doesn't catch the existing lowercase "content-type". Both values get merged.
    const headers = new Headers(
      buildAuthHeaders("abc123", {
        contentType: "application/json",
        headers: { "Content-Type": "multipart/form-data" },
      }),
    );
    expect(headers.get("Content-Type")).toContain("multipart/form-data");
    expect(headers.get("Content-Type")).toContain("application/json");
  });

  it("merges caller-provided headers", () => {
    const headers = new Headers(
      buildAuthHeaders("abc123", {
        headers: { "X-Custom": "value" },
      }),
    );
    expect(headers.get("X-Custom")).toBe("value");
    expect(headers.get("Authorization")).toBe("Token abc123");
  });

  it("adds organization headers when organization is provided", () => {
    const headers = new Headers(
      buildAuthHeaders("abc123", {
        organization: { id: 5, displayName: "Acme Corp", slug: "acme-corp" },
      }),
    );
    expect(headers.get("X-Organization-Slug")).toBe("acme-corp");
    expect(headers.get("X-Organization-Id")).toBe("5");
  });

  it("omits organization headers when organization is null", () => {
    const headers = new Headers(
      buildAuthHeaders("abc123", { organization: null }),
    );
    expect(headers.get("X-Organization-Slug")).toBeNull();
    expect(headers.get("X-Organization-Id")).toBeNull();
  });

  it("omits organization headers when no session and no org provided", () => {
    const headers = new Headers(buildAuthHeaders("abc123"));
    expect(headers.get("X-Organization-Slug")).toBeNull();
    expect(headers.get("X-Organization-Id")).toBeNull();
  });
});
