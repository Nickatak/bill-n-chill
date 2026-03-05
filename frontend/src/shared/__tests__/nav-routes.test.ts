import { describe, expect, it } from "vitest";
import {
  isRouteActive,
  businessMenuRoutes,
  workflowRoutes,
  type NavRoute,
} from "../shell/nav-routes";

// ---------------------------------------------------------------------------
// isRouteActive
// ---------------------------------------------------------------------------

describe("isRouteActive", () => {
  it("matches exact path from route.exact", () => {
    const route: NavRoute = { href: "/projects", label: "Projects", exact: ["/projects"] };
    expect(isRouteActive("/projects", route)).toBe(true);
  });

  it("does not match a different exact path", () => {
    const route: NavRoute = { href: "/projects", label: "Projects", exact: ["/projects"] };
    expect(isRouteActive("/invoices", route)).toBe(false);
  });

  it("falls back to href as exact match when no explicit exact array", () => {
    const route: NavRoute = { href: "/dashboard", label: "Dashboard" };
    expect(isRouteActive("/dashboard", route)).toBe(true);
  });

  it("matches prefix from route.startsWith", () => {
    const route: NavRoute = {
      href: "/projects",
      label: "Projects",
      exact: ["/projects"],
      startsWith: ["/projects/"],
    };
    expect(isRouteActive("/projects/42/estimates", route)).toBe(true);
  });

  it("does not match prefix when pathname does not start with it", () => {
    const route: NavRoute = {
      href: "/projects",
      label: "Projects",
      startsWith: ["/projects/"],
    };
    expect(isRouteActive("/invoices/5", route)).toBe(false);
  });

  it("matches any of multiple exact paths", () => {
    const route: NavRoute = {
      href: "/invoices",
      label: "Billing",
      exact: ["/invoices", "/bills"],
    };
    expect(isRouteActive("/bills", route)).toBe(true);
  });

  it("prefers exact match over prefix match", () => {
    const route: NavRoute = {
      href: "/projects",
      label: "Projects",
      exact: ["/projects"],
      startsWith: ["/projects/"],
    };
    expect(isRouteActive("/projects", route)).toBe(true);
  });

  it("returns false for root path on non-root route", () => {
    const route: NavRoute = { href: "/invoices", label: "Invoices", exact: ["/invoices"] };
    expect(isRouteActive("/", route)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route data sanity checks
// ---------------------------------------------------------------------------

describe("workflowRoutes", () => {
  it("has at least one route", () => {
    expect(workflowRoutes.length).toBeGreaterThan(0);
  });

  it("every route has a non-empty href and label", () => {
    for (const route of workflowRoutes) {
      expect(route.href).toBeTruthy();
      expect(route.label).toBeTruthy();
    }
  });

  it("Dashboard is the first route", () => {
    expect(workflowRoutes[0].label).toBe("Dashboard");
  });
});

describe("businessMenuRoutes", () => {
  it("has at least one route", () => {
    expect(businessMenuRoutes.length).toBeGreaterThan(0);
  });

  it("every route has a non-empty href and label", () => {
    for (const route of businessMenuRoutes) {
      expect(route.href).toBeTruthy();
      expect(route.label).toBeTruthy();
    }
  });
});
