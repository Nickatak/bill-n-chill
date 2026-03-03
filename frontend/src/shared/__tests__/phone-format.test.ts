import { describe, expect, it } from "vitest";
import { formatPhone } from "../phone-format";

describe("formatPhone", () => {
  it("formats a 10-digit number", () => {
    expect(formatPhone("5551234567")).toBe("(555) 123-4567");
  });

  it("formats a 10-digit number with existing formatting", () => {
    expect(formatPhone("555-123-4567")).toBe("(555) 123-4567");
  });

  it("formats a 10-digit number with dots", () => {
    expect(formatPhone("555.123.4567")).toBe("(555) 123-4567");
  });

  it("formats an 11-digit number with leading 1", () => {
    expect(formatPhone("15551234567")).toBe("(555) 123-4567");
  });

  it("formats an 11-digit with leading 1 and formatting", () => {
    expect(formatPhone("1-555-123-4567")).toBe("(555) 123-4567");
  });

  it("returns non-US numbers as-is", () => {
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });

  it("returns short numbers as-is", () => {
    expect(formatPhone("911")).toBe("911");
  });

  it("returns already-formatted number as-is when 10 digits", () => {
    expect(formatPhone("(555) 123-4567")).toBe("(555) 123-4567");
  });

  it("returns empty string as-is", () => {
    expect(formatPhone("")).toBe("");
  });

  it("returns non-numeric string as-is", () => {
    expect(formatPhone("call me")).toBe("call me");
  });
});
