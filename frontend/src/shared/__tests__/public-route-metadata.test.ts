import { describe, expect, it } from "vitest";
import {
  composePublicDocumentMetadataTitle,
  parsePublicTokenFromRef,
} from "../shell/public-route-metadata";

// ---------------------------------------------------------------------------
// parsePublicTokenFromRef
// ---------------------------------------------------------------------------

describe("parsePublicTokenFromRef", () => {
  it("extracts token from slug--token format", () => {
    expect(parsePublicTokenFromRef("my-quote--aBcDeFgH")).toBe("aBcDeFgH");
  });

  it("extracts longer token", () => {
    expect(parsePublicTokenFromRef("invoice-42--AbCdEfGhIjKlMnOp")).toBe(
      "AbCdEfGhIjKlMnOp",
    );
  });

  it("returns null when no -- separator exists", () => {
    expect(parsePublicTokenFromRef("plain-slug")).toBeNull();
  });

  it("returns null when token is too short", () => {
    expect(parsePublicTokenFromRef("slug--abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parsePublicTokenFromRef("")).toBeNull();
  });

  it("handles token at max length boundary (24 chars)", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUvWx";
    expect(token).toHaveLength(24);
    expect(parsePublicTokenFromRef(`slug--${token}`)).toBe(token);
  });

  it("returns null when token exceeds max length (25+ chars)", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUvWxY";
    expect(token).toHaveLength(25);
    expect(parsePublicTokenFromRef(`slug--${token}`)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// composePublicDocumentMetadataTitle
// ---------------------------------------------------------------------------

describe("composePublicDocumentMetadataTitle", () => {
  it("composes resolved title with fallback label", () => {
    expect(
      composePublicDocumentMetadataTitle("Kitchen Remodel", "Quote"),
    ).toBe("Kitchen Remodel | Quote");
  });

  it("returns fallback label when resolved title is null", () => {
    expect(composePublicDocumentMetadataTitle(null, "Invoice")).toBe("Invoice");
  });

  it("returns fallback label when resolved title is empty string", () => {
    expect(composePublicDocumentMetadataTitle("", "Change Order")).toBe(
      "Change Order",
    );
  });
});
