import { describe, expect, it } from "vitest";
import { isPublicAuthRoute, isPublicDocumentRoute } from "../public-routes";

// ---------------------------------------------------------------------------
// isPublicDocumentRoute
// ---------------------------------------------------------------------------

describe("isPublicDocumentRoute", () => {
  it("matches /estimate/:ref", () => {
    expect(isPublicDocumentRoute("/estimate/slug--aBcDeFgH")).toBe(true);
  });

  it("matches /invoice/:ref", () => {
    expect(isPublicDocumentRoute("/invoice/slug--aBcDeFgH")).toBe(true);
  });

  it("matches /change-order/:ref", () => {
    expect(isPublicDocumentRoute("/change-order/slug--aBcDeFgH")).toBe(true);
  });

  it("matches with trailing slash", () => {
    expect(isPublicDocumentRoute("/estimate/slug--aBcDeFgH/")).toBe(true);
  });

  it("rejects nested paths beyond the ref segment", () => {
    expect(isPublicDocumentRoute("/estimate/slug--aBcDeFgH/extra")).toBe(false);
  });

  it("rejects bare /estimate with no ref", () => {
    expect(isPublicDocumentRoute("/estimate")).toBe(false);
  });

  it("rejects unrelated paths", () => {
    expect(isPublicDocumentRoute("/projects")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPublicDocumentRoute(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPublicDocumentRoute(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isPublicDocumentRoute("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPublicAuthRoute
// ---------------------------------------------------------------------------

describe("isPublicAuthRoute", () => {
  it("returns true for /login", () => {
    expect(isPublicAuthRoute("/login")).toBe(true);
  });

  it("returns true for root / (public landing page)", () => {
    expect(isPublicAuthRoute("/")).toBe(true);
  });

  it("returns false for /dashboard (protected)", () => {
    expect(isPublicAuthRoute("/dashboard")).toBe(false);
  });

  it("returns true for /register", () => {
    expect(isPublicAuthRoute("/register")).toBe(true);
  });

  it("returns true for /verify-email", () => {
    expect(isPublicAuthRoute("/verify-email")).toBe(true);
  });

  it("returns true for public document routes", () => {
    expect(isPublicAuthRoute("/estimate/slug--aBcDeFgH")).toBe(true);
  });

  it("returns false for authenticated routes", () => {
    expect(isPublicAuthRoute("/projects")).toBe(false);
  });

  it("returns false for /invoices (list, not public viewer)", () => {
    expect(isPublicAuthRoute("/invoices")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isPublicAuthRoute(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isPublicAuthRoute(undefined)).toBe(false);
  });
});
