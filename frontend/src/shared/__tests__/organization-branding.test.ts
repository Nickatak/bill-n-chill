import { describe, expect, it } from "vitest";
import { resolveOrganizationBranding } from "../document-creator/organization-branding";
import { toAddressLines } from "../utils/address";

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
      billing_address: "123 Main St\nSuite 200",
      logo_url: "https://acme.com/logo.png",
      help_email: "help@acme.com",
    });
    expect(result.senderName).toBe("Acme Corp");
    expect(result.senderDisplayName).toBe("Acme Corp");
    expect(result.senderAddress).toBe("123 Main St\nSuite 200");
    expect(result.senderAddressLines).toEqual(["123 Main St", "Suite 200"]);
    expect(result.logoUrl).toBe("https://acme.com/logo.png");
    expect(result.helpEmail).toBe("help@acme.com");
  });

  it("uses 'Your Company' when display_name is empty", () => {
    const result = resolveOrganizationBranding({
      display_name: "",
      billing_address: "",
      logo_url: "",
      help_email: "",
    });
    expect(result.senderName).toBe("");
    expect(result.senderDisplayName).toBe("Your Company");
  });

  it("handles null defaults", () => {
    const result = resolveOrganizationBranding(null);
    expect(result.senderName).toBe("");
    expect(result.senderDisplayName).toBe("Your Company");
    expect(result.senderAddress).toBe("");
    expect(result.senderAddressLines).toEqual([]);
    expect(result.logoUrl).toBe("");
    expect(result.helpEmail).toBe("");
  });

  it("handles undefined defaults", () => {
    const result = resolveOrganizationBranding(undefined);
    expect(result.senderDisplayName).toBe("Your Company");
  });

  it("trims whitespace from all fields", () => {
    const result = resolveOrganizationBranding({
      display_name: "  Acme  ",
      billing_address: "  123 Main  ",
      logo_url: "  https://acme.com/logo.png  ",
      help_email: "  help@acme.com  ",
    });
    expect(result.senderName).toBe("Acme");
    expect(result.senderAddress).toBe("123 Main");
    expect(result.logoUrl).toBe("https://acme.com/logo.png");
    expect(result.helpEmail).toBe("help@acme.com");
  });
});
