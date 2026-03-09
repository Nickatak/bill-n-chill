import { describe, expect, it } from "vitest";

import type { Capabilities, SessionRole } from "../client-session";
import { canDo, hasAnyRole } from "../rbac";

describe("hasAnyRole", () => {
  it("returns true when role is in allowed list", () => {
    expect(hasAnyRole("owner", ["owner", "pm"])).toBe(true);
  });

  it("returns false when role is not in allowed list", () => {
    expect(hasAnyRole("viewer", ["owner", "pm"])).toBe(false);
  });

  it("returns false for undefined role", () => {
    expect(hasAnyRole(undefined, ["owner"])).toBe(false);
  });
});

describe("canDo", () => {
  const ownerCaps: Capabilities = {
    estimates: ["view", "create", "edit", "approve", "send"],
    invoices: ["view", "create", "edit"],
    payments: ["view", "create", "edit", "allocate"],
  };

  const viewerCaps: Capabilities = {
    estimates: ["view"],
    invoices: ["view"],
  };

  it("returns true when action is in resource array", () => {
    expect(canDo(ownerCaps, "estimates", "create")).toBe(true);
    expect(canDo(ownerCaps, "payments", "allocate")).toBe(true);
  });

  it("returns false when action is not in resource array", () => {
    expect(canDo(viewerCaps, "estimates", "create")).toBe(false);
    expect(canDo(viewerCaps, "invoices", "edit")).toBe(false);
  });

  it("returns false for missing resource", () => {
    expect(canDo(viewerCaps, "payments", "view")).toBe(false);
  });

  it("returns false for undefined capabilities", () => {
    expect(canDo(undefined, "estimates", "create")).toBe(false);
  });

  it("returns false for empty capabilities", () => {
    expect(canDo({}, "estimates", "create")).toBe(false);
  });

  it("returns true for view action in viewer caps", () => {
    expect(canDo(viewerCaps, "estimates", "view")).toBe(true);
    expect(canDo(viewerCaps, "invoices", "view")).toBe(true);
  });
});
