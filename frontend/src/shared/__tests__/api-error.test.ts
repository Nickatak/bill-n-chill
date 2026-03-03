import { describe, expect, it } from "vitest";
import { readApiErrorMessage } from "../api/error";

describe("readApiErrorMessage", () => {
  it("returns top-level error message when present", () => {
    const payload = { error: { message: "Not found" } };
    expect(readApiErrorMessage(payload, "fallback")).toBe("Not found");
  });

  it("trims top-level message whitespace", () => {
    const payload = { error: { message: "  Conflict  " } };
    expect(readApiErrorMessage(payload, "fallback")).toBe("Conflict");
  });

  it("falls back to first field error when no top-level message", () => {
    const payload = {
      error: {
        fields: { email: ["This field is required."] },
      },
    };
    expect(readApiErrorMessage(payload, "fallback")).toBe(
      "email: This field is required.",
    );
  });

  it("skips empty field message arrays", () => {
    const payload = {
      error: {
        fields: {
          name: [],
          email: ["Invalid email"],
        },
      },
    };
    expect(readApiErrorMessage(payload, "fallback")).toBe(
      "email: Invalid email",
    );
  });

  it("returns fallback when error object is empty", () => {
    expect(readApiErrorMessage({ error: {} }, "fallback")).toBe("fallback");
  });

  it("returns fallback for undefined payload", () => {
    expect(readApiErrorMessage(undefined, "Something went wrong")).toBe(
      "Something went wrong",
    );
  });

  it("returns fallback when message is blank/whitespace", () => {
    const payload = { error: { message: "   " } };
    expect(readApiErrorMessage(payload, "fallback")).toBe("fallback");
  });

  it("prefers top-level message over field errors", () => {
    const payload = {
      error: {
        message: "Top level",
        fields: { email: ["Field level"] },
      },
    };
    expect(readApiErrorMessage(payload, "fallback")).toBe("Top level");
  });

  it("returns fallback when fields has non-array values", () => {
    const payload = {
      error: {
        fields: { email: "not an array" as unknown as string[] },
      },
    };
    expect(readApiErrorMessage(payload, "fallback")).toBe("fallback");
  });
});
