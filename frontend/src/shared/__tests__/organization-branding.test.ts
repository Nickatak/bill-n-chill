import { describe, expect, it } from "vitest";
import {
  resolveOrganizationBranding,
  toAddressLines,
} from "../document-creator/organization-branding";

// ---------------------------------------------------------------------------
// toAddressLines
// ---------------------------------------------------------------------------

describe("toAddressLines", () => {
  it("splits multi-line address into trimmed lines", () => {
    expect(toAddressLines("123 Main St\nSuite 200\nSpringfield, IL")).toEqual([
      "123 Main St",
      "Suite 200",
      "Springfield, IL",
    ]);
  });

  it("discards blank lines", () => {
    expect(toAddressLines("123 Main St\n\nSpringfield")).toEqual([
      "123 Main St",
      "Springfield",
    ]);
  });

  it("trims whitespace from each line", () => {
    expect(toAddressLines("  123 Main St  \n  Suite 200  ")).toEqual([
      "123 Main St",
      "Suite 200",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(toAddressLines("")).toEqual([]);
  });

  it("returns single-element array for single-line address", () => {
    expect(toAddressLines("123 Main St")).toEqual(["123 Main St"]);
  });
});

// ---------------------------------------------------------------------------
// resolveOrganizationBranding
// ---------------------------------------------------------------------------

describe("resolveOrganizationBranding", () => {
  it("resolves all fields from complete defaults", () => {
    const result = resolveOrganizationBranding({
      display_name: "Acme Corp",
      invoice_sender_name: "Acme Billing",
      invoice_sender_email: "billing@acme.com",
      invoice_sender_address: "123 Main St\nSuite 200",
      logo_url: "https://acme.com/logo.png",
    });
    expect(result.senderName).toBe("Acme Billing");
    expect(result.senderDisplayName).toBe("Acme Billing");
    expect(result.senderEmail).toBe("billing@acme.com");
    expect(result.senderAddress).toBe("123 Main St\nSuite 200");
    expect(result.senderAddressLines).toEqual(["123 Main St", "Suite 200"]);
    expect(result.logoUrl).toBe("https://acme.com/logo.png");
  });

  it("falls back to display_name when invoice_sender_name is empty", () => {
    const result = resolveOrganizationBranding({
      display_name: "Acme Corp",
      invoice_sender_name: "",
      invoice_sender_email: "",
      invoice_sender_address: "",
      logo_url: "",
    });
    expect(result.senderName).toBe("Acme Corp");
    expect(result.senderDisplayName).toBe("Acme Corp");
  });

  it("uses 'Your Company' when both name fields are empty", () => {
    const result = resolveOrganizationBranding({
      display_name: "",
      invoice_sender_name: "",
      invoice_sender_email: "",
      invoice_sender_address: "",
      logo_url: "",
    });
    expect(result.senderName).toBe("");
    expect(result.senderDisplayName).toBe("Your Company");
  });

  it("handles null defaults", () => {
    const result = resolveOrganizationBranding(null);
    expect(result.senderName).toBe("");
    expect(result.senderDisplayName).toBe("Your Company");
    expect(result.senderEmail).toBe("");
    expect(result.senderAddress).toBe("");
    expect(result.senderAddressLines).toEqual([]);
    expect(result.logoUrl).toBe("");
  });

  it("handles undefined defaults", () => {
    const result = resolveOrganizationBranding(undefined);
    expect(result.senderDisplayName).toBe("Your Company");
  });

  it("trims whitespace from all fields", () => {
    const result = resolveOrganizationBranding({
      display_name: "  Acme  ",
      invoice_sender_name: "",
      invoice_sender_email: "  billing@acme.com  ",
      invoice_sender_address: "  123 Main  ",
      logo_url: "  https://acme.com/logo.png  ",
    });
    expect(result.senderName).toBe("Acme");
    expect(result.senderEmail).toBe("billing@acme.com");
    expect(result.senderAddress).toBe("123 Main");
    expect(result.logoUrl).toBe("https://acme.com/logo.png");
  });
});
