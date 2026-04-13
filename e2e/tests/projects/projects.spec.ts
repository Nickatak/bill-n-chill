import { test, expect } from "@playwright/test";
import {
  registerAndLogin,
  loginAndNavigate,
  type E2ESession,
} from "../../helpers/auth";
import {
  quickAddCustomer,
  createProject,
  patchProject,
} from "../../helpers/api";
import { clearMailbox } from "../../helpers/mailpit";

/**
 * Projects page e2e tests.
 *
 * Tests cover the project list, profile editor, status transitions,
 * financial metrics panel, workflow pipeline links, and URL deep-linking.
 *
 * All tests share a single authenticated user with pre-seeded projects.
 */

let authToken: string;
let session: E2ESession;

// Pre-seeded project IDs for reuse across tests
let prospectProjectId: number;
let activeProjectId: number;
let onHoldProjectId: number;
let completedProjectId: number;
let cancelledProjectId: number;

test.beforeAll(async () => {
  await clearMailbox();
  const result = await registerAndLogin();
  authToken = result.token;
  session = result.session;

  // Create a customer to own the projects
  const custResult = await quickAddCustomer(authToken, {
    full_name: "Project Test Owner",
    phone: "555-900-0001",
  });
  const customerId = custResult.customer!.id;

  // Seed projects in various statuses
  const prospect = await createProject(authToken, customerId, {
    name: "Prospect Porch",
    site_address: "1 Prospect Ln",
    status: "prospect",
  });
  prospectProjectId = prospect.project.id;

  const active = await createProject(authToken, customerId, {
    name: "Active Kitchen",
    site_address: "2 Active Ave",
    status: "active",
  });
  activeProjectId = active.project.id;

  // Create on_hold: start as active, then PATCH to on_hold
  const onHoldBase = await createProject(authToken, customerId, {
    name: "Paused Bathroom",
    site_address: "3 Hold St",
    status: "active",
  });
  onHoldProjectId = onHoldBase.project.id;
  await patchProject(authToken, onHoldProjectId, { status: "on_hold" });

  // Create completed: start as active, then PATCH to completed
  const completedBase = await createProject(authToken, customerId, {
    name: "Done Garage",
    site_address: "4 Done Dr",
    status: "active",
  });
  completedProjectId = completedBase.project.id;
  await patchProject(authToken, completedProjectId, { status: "completed" });

  // Create cancelled: start as prospect, then PATCH to cancelled
  const cancelledBase = await createProject(authToken, customerId, {
    name: "Cancelled Deck",
    site_address: "5 Cancel Ct",
    status: "prospect",
  });
  cancelledProjectId = cancelledBase.project.id;
  await patchProject(authToken, cancelledProjectId, { status: "cancelled" });
});

// ---------------------------------------------------------------------------
// Project List & Selection
// ---------------------------------------------------------------------------

test.describe("Project List", () => {
  test("displays projects and selects one to show overview", async ({
    page,
  }) => {
    await loginAndNavigate(page, session, "/projects");

    // Default filters: active, on_hold, prospect — so these should all be visible
    await expect(
      page.locator("[role=button]").filter({ hasText: "Active Kitchen" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("[role=button]").filter({ hasText: "Prospect Porch" }),
    ).toBeVisible();
    await expect(
      page.locator("[role=button]").filter({ hasText: "Paused Bathroom" }),
    ).toBeVisible();

    // Click a project card to select it
    await page
      .locator("[role=button]").filter({ hasText: "Active Kitchen" })
      .click();

    // Overview section shows the project name
    await expect(page.getByText("Active Kitchen").first()).toBeVisible();

    // Financial metrics panel appears
    await expect(page.getByText("Contract Total")).toBeVisible();
    await expect(page.getByText("Invoiced")).toBeVisible();
  });

  test("searches projects by name", async ({ page }) => {
    await loginAndNavigate(page, session, "/projects");

    await page
      .getByPlaceholder("Search by id, name, customer, or status")
      .fill("Prospect Porch");

    // Only the matching project should remain
    await expect(
      page.locator("[role=button]").filter({ hasText: "Prospect Porch" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator("[role=button]").filter({ hasText: "Active Kitchen" }),
    ).not.toBeVisible();
  });

  test("status filter pills toggle project visibility", async ({ page }) => {
    await loginAndNavigate(page, session, "/projects");

    // Show all projects first
    await page
      .getByRole("button", { name: /Show all projects/i })
      .click();

    // Completed and cancelled should now be visible
    await expect(
      page.locator("[role=button]").filter({ hasText: "Done Garage" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator("[role=button]").filter({ hasText: "Cancelled Deck" }),
    ).toBeVisible();

    // Reset filters — completed/cancelled should disappear
    await page
      .getByRole("button", { name: /Reset filters/i })
      .click();

    await expect(
      page.locator("[role=button]").filter({ hasText: "Done Garage" }),
    ).not.toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator("[role=button]").filter({ hasText: "Cancelled Deck" }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Profile Editor
// ---------------------------------------------------------------------------

test.describe("Profile Editor", () => {
  test("edits project name", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${activeProjectId}`,
    );

    // Wait for overview to render
    await expect(page.getByText("Active Kitchen").first()).toBeVisible({
      timeout: 10_000,
    });

    // Open editor
    await page.getByText("Edit Project").click();
    await expect(page.getByLabel("Project name")).toBeVisible({
      timeout: 3_000,
    });

    // Change name
    await page.getByLabel("Project name").clear();
    await page.getByLabel("Project name").fill("Active Kitchen Reno");
    await page.getByRole("button", { name: "Save" }).click();

    // Success message
    await expect(page.getByText(/Project #\d+ saved/)).toBeVisible({
      timeout: 5_000,
    });

    // Project card updates
    await expect(
      page.locator("[role=button]").filter({ hasText: "Active Kitchen Reno" }),
    ).toBeVisible();

    // Restore original name for other tests
    await page.getByLabel("Project name").clear();
    await page.getByLabel("Project name").fill("Active Kitchen");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Project #\d+ saved/)).toBeVisible({
      timeout: 5_000,
    });
  });

  test("changes project status via status pills", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${prospectProjectId}`,
    );

    await expect(page.getByText("Prospect Porch").first()).toBeVisible({
      timeout: 10_000,
    });

    await page.getByText("Edit Project").click();
    await expect(page.getByLabel("Project name")).toBeVisible({
      timeout: 3_000,
    });

    // Current status should show "prospect"
    await expect(page.getByText(/Current: prospect/)).toBeVisible();

    // Valid transitions for prospect: active, cancelled
    // Click "active" pill (use button role to avoid matching the container div)
    await page
      .getByRole("button", { name: "active", exact: true })
      .click();

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Project #\d+ saved/)).toBeVisible({
      timeout: 5_000,
    });

    // Revert to prospect — but wait, prospect is not a valid transition from active.
    // So we leave it as active. Other tests should not depend on this project being prospect.
  });

  test("terminal project shows hint instead of edit button", async ({
    page,
  }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${completedProjectId}`,
    );

    // Need to show completed projects in the filter
    await page
      .getByRole("button", { name: /Show all projects/i })
      .click();

    // Select the completed project
    await page
      .locator("[role=button]").filter({ hasText: "Done Garage" })
      .click();

    // Should show terminal hint, not edit button
    await expect(
      page.getByText("Completed — no longer editable"),
    ).toBeVisible({ timeout: 5_000 });

    // "Edit Project" button should NOT be visible
    await expect(page.getByText("Edit Project")).not.toBeVisible();
  });

  test("cancelled project shows terminal hint", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${cancelledProjectId}`,
    );

    await page
      .getByRole("button", { name: /Show all projects/i })
      .click();

    await page
      .locator("[role=button]").filter({ hasText: "Cancelled Deck" })
      .click();

    await expect(
      page.getByText("Cancelled — no longer editable"),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Financial Metrics
// ---------------------------------------------------------------------------

test.describe("Financial Metrics", () => {
  test("displays metric labels with values when project selected", async ({
    page,
  }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${activeProjectId}`,
    );

    await expect(page.getByText("Contract Total")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Invoiced")).toBeVisible();
    await expect(page.getByText("Paid")).toBeVisible();
    await expect(page.getByText("Outstanding")).toBeVisible();
    await expect(page.getByText("Remaining to Invoice")).toBeVisible();

    // Metric values should load (either $0.00 or -- initially, then resolve)
    // Wait for summary to load (values change from "--" to actual values)
    const contractRow = page.locator("[class*=metricRow]").filter({ hasText: "Contract Total" });
    await expect(contractRow.locator("strong")).not.toHaveText("--", {
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Workflow Pipeline
// ---------------------------------------------------------------------------

test.describe("Workflow Pipeline", () => {
  test("pipeline links navigate to correct subroutes", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${activeProjectId}`,
    );

    // Wait for pipeline to render
    await expect(
      page.getByRole("navigation", { name: "Project workflow" }),
    ).toBeVisible({ timeout: 10_000 });

    // Verify all 4 pipeline links exist with correct hrefs
    const quotesLink = page.getByRole("link", { name: /Quotes/ });
    await expect(quotesLink).toBeVisible();
    await expect(quotesLink).toHaveAttribute(
      "href",
      `/projects/${activeProjectId}/quotes`,
    );

    const coLink = page.getByRole("link", { name: /Change Orders/ });
    await expect(coLink).toBeVisible();
    await expect(coLink).toHaveAttribute(
      "href",
      `/projects/${activeProjectId}/change-orders`,
    );

    const invoicesLink = page.getByRole("link", { name: /Invoices/ });
    await expect(invoicesLink).toBeVisible();
    await expect(invoicesLink).toHaveAttribute(
      "href",
      `/projects/${activeProjectId}/invoices`,
    );

    const expensesLink = page.getByRole("link", { name: /Expenses/ });
    await expect(expensesLink).toBeVisible();
    await expect(expensesLink).toHaveAttribute(
      "href",
      `/projects/${activeProjectId}/bills`,
    );
  });

  test("quotes pipeline link navigates to quotes page", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${activeProjectId}`,
    );

    await expect(
      page.getByRole("link", { name: /Quotes/ }),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: /Quotes/ }).click();
    await page.waitForURL(`**/projects/${activeProjectId}/quotes`, {
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// URL Deep-linking
// ---------------------------------------------------------------------------

test.describe("Navigation", () => {
  test("deep-links to project via URL param", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${onHoldProjectId}`,
    );

    // The on_hold project should be auto-selected and visible
    await expect(page.getByText("Paused Bathroom").first()).toBeVisible({
      timeout: 10_000,
    });

    // Its card should be active/selected in the list
    const card = page.locator("[class*=projectCardActive]");
    await expect(card).toContainText("Paused Bathroom");
  });

  test("scopes project list by customer via URL param", async ({ page }) => {
    // Create a second customer with a different project
    const cust2 = await quickAddCustomer(authToken, {
      full_name: "Other Owner",
      phone: "555-900-0099",
      create_project: true,
      project_name: "Other Job",
      project_address: "999 Other St",
      project_status: "active",
    });
    const otherCustomerId = cust2.customer!.id;

    // Navigate scoped to the original customer (who owns our seeded projects)
    // First, find the original customer by checking one of the seeded projects
    await loginAndNavigate(
      page,
      session,
      `/projects?customer=${otherCustomerId}`,
    );

    // Should only show "Other Job" — not our seeded projects
    await expect(
      page.locator("[role=button]").filter({ hasText: "Other Job" }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.locator("[role=button]").filter({ hasText: "Active Kitchen" }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Record Payment Button
// ---------------------------------------------------------------------------

test.describe("Record Payment", () => {
  test("button is disabled when no payable invoices exist", async ({
    page,
  }) => {
    await loginAndNavigate(
      page,
      session,
      `/projects?project=${activeProjectId}`,
    );

    // Wait for the toolbar to render
    await expect(
      page.getByRole("toolbar", { name: "Project actions" }),
    ).toBeVisible({ timeout: 10_000 });

    // No invoices exist, so Record Payment should be disabled
    await expect(
      page.getByRole("button", { name: "Record Payment" }),
    ).toBeDisabled();
  });
});
