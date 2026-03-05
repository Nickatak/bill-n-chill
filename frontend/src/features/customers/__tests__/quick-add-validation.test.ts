import { describe, expect, it } from "vitest";
import { validateLeadFields } from "../hooks/quick-add-validation";
import type { CustomerIntakePayload } from "../types";

function makePayload(overrides: Partial<CustomerIntakePayload> = {}): CustomerIntakePayload {
  return {
    full_name: "Jane Doe",
    phone: "5551234567",
    project_address: "123 Main St",
    email: "",
    notes: "",
    source: "quick_add",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateLeadFields — customer_only intent
// ---------------------------------------------------------------------------

describe("validateLeadFields (customer_only)", () => {
  const opts = { intent: "customer_only" as const, projectName: "" };

  it("returns no errors for valid payload", () => {
    expect(validateLeadFields(makePayload(), opts)).toEqual({});
  });

  it("requires full_name", () => {
    const errors = validateLeadFields(makePayload({ full_name: "" }), opts);
    expect(errors.full_name).toBeTruthy();
  });

  it("requires full_name (whitespace only)", () => {
    const errors = validateLeadFields(makePayload({ full_name: "   " }), opts);
    expect(errors.full_name).toBeTruthy();
  });

  it("requires phone/contact", () => {
    const errors = validateLeadFields(makePayload({ phone: "" }), opts);
    expect(errors.phone).toBeTruthy();
  });

  it("accepts a 10-digit phone", () => {
    const errors = validateLeadFields(makePayload({ phone: "5551234567" }), opts);
    expect(errors.phone).toBeUndefined();
  });

  it("accepts a formatted phone", () => {
    const errors = validateLeadFields(makePayload({ phone: "(555) 123-4567" }), opts);
    expect(errors.phone).toBeUndefined();
  });

  it("accepts an email in the phone field", () => {
    const errors = validateLeadFields(makePayload({ phone: "jane@example.com" }), opts);
    expect(errors.phone).toBeUndefined();
  });

  it("rejects invalid contact value", () => {
    const errors = validateLeadFields(makePayload({ phone: "not valid!" }), opts);
    expect(errors.phone).toBeTruthy();
  });

  it("does not require project fields for customer_only", () => {
    const errors = validateLeadFields(makePayload(), opts);
    expect(errors.project_name).toBeUndefined();
    expect(errors.project_address).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateLeadFields — customer_and_project intent
// ---------------------------------------------------------------------------

describe("validateLeadFields (customer_and_project)", () => {
  const opts = { intent: "customer_and_project" as const, projectName: "New Build" };

  it("returns no errors for valid payload with project fields", () => {
    const errors = validateLeadFields(makePayload(), opts);
    expect(errors).toEqual({});
  });

  it("requires project_name", () => {
    const errors = validateLeadFields(makePayload(), {
      ...opts,
      projectName: "",
    });
    expect(errors.project_name).toBeTruthy();
  });

  it("requires project_name (whitespace only)", () => {
    const errors = validateLeadFields(makePayload(), {
      ...opts,
      projectName: "   ",
    });
    expect(errors.project_name).toBeTruthy();
  });

  it("requires project_address", () => {
    const errors = validateLeadFields(
      makePayload({ project_address: "" }),
      opts,
    );
    expect(errors.project_address).toBeTruthy();
  });

  it("still requires full_name and phone", () => {
    const errors = validateLeadFields(
      makePayload({ full_name: "", phone: "" }),
      opts,
    );
    expect(errors.full_name).toBeTruthy();
    expect(errors.phone).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Contact field edge cases
// ---------------------------------------------------------------------------

describe("validateLeadFields — contact field edge cases", () => {
  const opts = { intent: "customer_only" as const, projectName: "" };

  it("accepts international phone format", () => {
    const errors = validateLeadFields(makePayload({ phone: "+1-555-123-4567" }), opts);
    expect(errors.phone).toBeUndefined();
  });

  it("accepts phone with dots", () => {
    const errors = validateLeadFields(makePayload({ phone: "555.123.4567" }), opts);
    expect(errors.phone).toBeUndefined();
  });

  it("rejects too-short digit sequence", () => {
    const errors = validateLeadFields(makePayload({ phone: "123" }), opts);
    expect(errors.phone).toBeTruthy();
  });

  it("accepts email with subdomain", () => {
    const errors = validateLeadFields(makePayload({ phone: "jane@mail.example.com" }), opts);
    expect(errors.phone).toBeUndefined();
  });
});
