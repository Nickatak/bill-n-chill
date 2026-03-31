import { describe, expect, it } from "vitest";

import type { Capabilities } from "../client-session";
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
    quotes: ["view", "create", "edit", "approve", "send"],
    invoices: ["view", "create", "edit"],
    payments: ["view", "create", "edit", "allocate"],
  };

  const viewerCaps: Capabilities = {
    quotes: ["view"],
    invoices: ["view"],
  };

  it("returns true when action is in resource array", () => {
    expect(canDo(ownerCaps, "quotes", "create")).toBe(true);
    expect(canDo(ownerCaps, "payments", "allocate")).toBe(true);
  });

  it("returns false when action is not in resource array", () => {
    expect(canDo(viewerCaps, "quotes", "create")).toBe(false);
    expect(canDo(viewerCaps, "invoices", "edit")).toBe(false);
  });

  it("returns false for missing resource", () => {
    expect(canDo(viewerCaps, "payments", "view")).toBe(false);
  });

  it("returns false for undefined capabilities", () => {
    expect(canDo(undefined, "quotes", "create")).toBe(false);
  });

  it("returns false for empty capabilities", () => {
    expect(canDo({}, "quotes", "create")).toBe(false);
  });

  it("returns true for view action in viewer caps", () => {
    expect(canDo(viewerCaps, "quotes", "view")).toBe(true);
    expect(canDo(viewerCaps, "invoices", "view")).toBe(true);
  });
});
