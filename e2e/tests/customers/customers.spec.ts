import { test, expect } from "@playwright/test";
import {
  registerAndLogin,
  loginAndNavigate,
  type E2ESession,
} from "../../helpers/auth";
import {
  quickAddCustomer,
  createProject,
  patchCustomer,
} from "../../helpers/api";
import { clearMailbox } from "../../helpers/mailpit";

/**
 * Customers page e2e tests.
 *
 * All tests share a single authenticated user (created in beforeAll)
 * but each test gets its own browser page. Data created via quick-add
 * or API persists across tests within the same worker, so test names
 * are unique to avoid collisions.
 */

let authToken: string;
let session: E2ESession;

test.beforeAll(async () => {
  await clearMailbox();
  const result = await registerAndLogin();
  authToken = result.token;
  session = result.session;
});

// ---------------------------------------------------------------------------
// Quick Add
// ---------------------------------------------------------------------------

test.describe("Quick Add", () => {
  test("creates customer only", async ({ page }) => {
    await loginAndNavigate(page, session);

    await page.getByLabel("Full name").fill("Quinn Customeronly");
    await page.getByLabel("Phone (or email)").fill("555-100-0001");
    await page.getByRole("button", { name: "Save Customer Only" }).click();

    // Confirmation message
    await expect(page.getByRole("status")).toContainText("Customer created", {
      timeout: 10_000,
    });

    // Customer appears in the browse list
    await expect(
      page.locator("button[class*=customerNameLink]").filter({ hasText: "Quinn Customeronly" }),
    ).toBeVisible();
  });

  test("creates customer + project", async ({ page }) => {
    await loginAndNavigate(page, session);

    await page.getByLabel("Full name").fill("Petra Withproject");
    await page.getByLabel("Phone (or email)").fill("555-100-0002");
    await page.getByLabel("Project name").fill("Kitchen Remodel");
    await page.getByLabel("Project address").fill("123 Main St");

    await page
      .getByRole("button", { name: "Save Customer + Start Project" })
      .click();

    await expect(page.getByRole("status")).toContainText(
      "Customer + project created",
      { timeout: 10_000 },
    );

    // Both customer and project are linked in the status message
    await expect(page.getByRole("status")).toContainText("Customer #");
    await expect(page.getByRole("status")).toContainText("Project #");
  });

  test("shows validation errors for empty required fields", async ({
    page,
  }) => {
    await loginAndNavigate(page, session);

    // Submit with nothing filled in
    await page.getByRole("button", { name: "Save Customer Only" }).click();

    // Should show validation error
    await expect(
      page.getByText("Fix the required fields"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("shows validation errors when project fields missing", async ({
    page,
  }) => {
    await loginAndNavigate(page, session);

    // Fill customer fields but not project fields
    await page.getByLabel("Full name").fill("Validation Test");
    await page.getByLabel("Phone (or email)").fill("555-100-0099");

    // Try to save with project (project fields empty)
    await page
      .getByRole("button", { name: "Save Customer + Start Project" })
      .click();

    await expect(
      page.getByText("Fix the required fields"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("detects duplicates and resolves with use-existing", async ({
    page,
  }) => {
    // Create a customer via API first
    await quickAddCustomer(authToken, {
      full_name: "Dupe Detector",
      phone: "555-200-0001",
    });

    await loginAndNavigate(page, session);

    // Try to create another customer with the same phone
    await page.getByLabel("Full name").fill("Dupe Detector Copy");
    await page.getByLabel("Phone (or email)").fill("555-200-0001");
    await page.getByLabel("Project name").fill("Dupe Project");
    await page.getByLabel("Project address").fill("456 Dupe Ave");

    await page
      .getByRole("button", { name: "Save Customer + Start Project" })
      .click();

    // Duplicate resolution panel appears with the matching candidate
    const dupePanel = page.getByLabel("Duplicate resolution");
    await expect(dupePanel).toBeVisible({ timeout: 10_000 });
    await expect(
      dupePanel.getByRole("link", { name: /Dupe Detector/ }),
    ).toBeVisible();

    // Click the resolve button (not the card article which also has role="button")
    await dupePanel
      .locator("button", { hasText: "Use Customer + Start Project" })
      .click();

    // Should resolve and show success
    await expect(page.getByRole("status").first()).toContainText(
      "project created",
      { timeout: 10_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Customer Editor
// ---------------------------------------------------------------------------

test.describe("Customer Editor", () => {
  test("edits customer fields", async ({ page }) => {
    // Create a customer to edit
    const result = await quickAddCustomer(authToken, {
      full_name: "Editable Eddie",
      phone: "555-300-0001",
    });
    const customerId = result.customer!.id;

    await loginAndNavigate(page, session, `/customers?customer=${customerId}`);

    // Click customer name to open editor
    await page
      .locator("button[class*=customerNameLink]")
      .filter({ hasText: "Editable Eddie" })
      .click();

    // Wait for editor modal
    const dialog = page.getByRole("dialog", { name: "Edit customer" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Edit fields
    await dialog.getByLabel("Display name").clear();
    await dialog.getByLabel("Display name").fill("Eddie Updated");
    await dialog.getByLabel("Phone").clear();
    await dialog.getByLabel("Phone").fill("555-300-9999");

    await dialog.getByRole("button", { name: "Save Customer" }).click();

    // Updated name appears in the list
    await expect(
      page.locator("button[class*=customerNameLink]").filter({ hasText: "Eddie Updated" }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("archives customer without active projects", async ({ page }) => {
    // Create a customer with no projects
    const result = await quickAddCustomer(authToken, {
      full_name: "Archivable Annie",
      phone: "555-400-0001",
    });

    // Navigate without deep-link (deep-link switches activity filter to "all")
    await loginAndNavigate(page, session);

    // Search for the customer
    await page
      .getByPlaceholder("Search by name, phone, email, or address")
      .fill("Archivable Annie");

    await expect(
      page.locator("button[class*=customerNameLink]").filter({ hasText: "Archivable Annie" }),
    ).toBeVisible({ timeout: 5_000 });

    // Open editor
    await page
      .locator("button[class*=customerNameLink]")
      .filter({ hasText: "Archivable Annie" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Edit customer" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Toggle archive
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Save Customer" }).click();

    // Dialog should close and customer should disappear from the active-filtered list
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator("button[class*=customerNameLink]").filter({ hasText: "Archivable Annie" }),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("blocks archive when customer has active project", async ({ page }) => {
    // Create customer with an active project
    const custResult = await quickAddCustomer(authToken, {
      full_name: "Blocked Bob",
      phone: "555-400-0002",
      create_project: true,
      project_name: "Active Job",
      project_address: "789 Block St",
      project_status: "active",
    });
    const customerId = custResult.customer!.id;

    await loginAndNavigate(page, session, `/customers?customer=${customerId}`);

    // Open editor
    await page
      .locator("button[class*=customerNameLink]")
      .filter({ hasText: "Blocked Bob" })
      .click();

    const dialog = page.getByRole("dialog", { name: "Edit customer" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Archive checkbox should be disabled
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Browse & Filter
// ---------------------------------------------------------------------------

test.describe("Browse & Filter", () => {
  // Seed data for browse tests
  test.beforeAll(async () => {
    await quickAddCustomer(authToken, {
      full_name: "Searchable Sarah",
      phone: "555-500-0001",
    });
    await quickAddCustomer(authToken, {
      full_name: "Findable Frank",
      phone: "555-500-0002",
      create_project: true,
      project_name: "Frank Project",
      project_address: "100 Search Ln",
      project_status: "active",
    });
  });

  test("searches by name", async ({ page }) => {
    await loginAndNavigate(page, session);

    await page
      .getByPlaceholder("Search by name, phone, email, or address")
      .fill("Searchable Sarah");

    // Wait for debounced search
    await expect(page.getByText("Searchable Sarah")).toBeVisible({
      timeout: 5_000,
    });

    // Other seeded customers should not be visible
    await expect(page.getByText("Findable Frank")).not.toBeVisible();
  });

  test("activity filter toggles archived customers", async ({ page }) => {
    // Create and archive a customer via API
    const result = await quickAddCustomer(authToken, {
      full_name: "Filtered Fiona",
      phone: "555-500-0003",
    });
    await patchCustomer(authToken, result.customer!.id, { is_archived: true });

    await loginAndNavigate(page, session);

    // Search for the archived customer specifically
    await page
      .getByPlaceholder("Search by name, phone, email, or address")
      .fill("Filtered Fiona");

    // Default is "Active" filter - archived customer should not be visible
    await expect(page.getByText("Filtered Fiona")).not.toBeVisible({
      timeout: 3_000,
    });

    // Switch to "All" - the first "All" button is in the activity filter group
    const filterControls = page.locator("[class*=filterControls]");
    const activityGroup = filterControls.locator("[class*=group]").first();
    await activityGroup.getByText("All").click();

    // Now the archived customer should appear
    await expect(page.getByText("Filtered Fiona")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("project filter shows only customers with projects", async ({
    page,
  }) => {
    await loginAndNavigate(page, session);

    // Click "With Projects" filter
    await page.getByRole("button", { name: "With Projects" }).click();

    // Findable Frank has a project - should be visible
    await expect(page.getByText("Findable Frank")).toBeVisible({
      timeout: 5_000,
    });

    // Searchable Sarah has no project - should not be visible
    await expect(page.getByText("Searchable Sarah")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Project Accordion
// ---------------------------------------------------------------------------

test.describe("Project Accordion", () => {
  let accordionCustomerId: number;

  test.beforeAll(async () => {
    // Create a customer with multiple projects in different statuses
    const custResult = await quickAddCustomer(authToken, {
      full_name: "Accordion Ace",
      phone: "555-600-0001",
      create_project: true,
      project_name: "Prospect Job",
      project_address: "200 Accordion Way",
      project_status: "prospect",
    });
    accordionCustomerId = custResult.customer!.id;

    // Add an active project
    await createProject(authToken, accordionCustomerId, {
      name: "Active Job",
      site_address: "201 Accordion Way",
      status: "active",
    });
  });

  test("expands accordion and shows projects", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/customers?customer=${accordionCustomerId}`,
    );

    // Find the accordion toggle for Accordion Ace
    const customerRow = page.locator("[class*=gridRow]", {
      hasText: "Accordion Ace",
    });

    // Expand projects
    await customerRow
      .getByRole("button", { name: /Show projects/i })
      .click();

    // Both projects should be visible
    await expect(customerRow.getByText("Prospect Job")).toBeVisible({
      timeout: 5_000,
    });
    await expect(customerRow.getByText("Active Job")).toBeVisible();
  });

  test("filters projects by status chips", async ({ page }) => {
    await loginAndNavigate(
      page,
      session,
      `/customers?customer=${accordionCustomerId}`,
    );

    const customerRow = page.locator("[class*=gridRow]", {
      hasText: "Accordion Ace",
    });

    // Expand projects
    await customerRow
      .getByRole("button", { name: /Show projects/i })
      .click();
    await expect(customerRow.getByText("Prospect Job")).toBeVisible({
      timeout: 5_000,
    });

    // Click the prospect status chip to toggle it off (exact match to avoid hitting the accordion toggle)
    await customerRow
      .getByRole("button", { name: /^prospect \(\d+\)$/i })
      .click();

    // Prospect Job should be hidden, Active Job should remain
    await expect(customerRow.getByText("Prospect Job")).not.toBeVisible();
    await expect(customerRow.getByText("Active Job")).toBeVisible();

    // Click "Show all" to reset
    await customerRow.getByRole("button", { name: "Show all" }).click();
    await expect(customerRow.getByText("Prospect Job")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Project Creation from Customer Context
// ---------------------------------------------------------------------------

test.describe("Project Creation", () => {
  test("creates project from customer context via modal", async ({ page }) => {
    const custResult = await quickAddCustomer(authToken, {
      full_name: "Project Parent Pat",
      phone: "555-700-0001",
    });
    const customerId = custResult.customer!.id;

    await loginAndNavigate(
      page,
      session,
      `/customers?customer=${customerId}`,
    );

    // Click "Add New Project" button for this customer
    await page
      .getByRole("button", { name: `Add new project for Project Parent Pat` })
      .click();

    // Project creation modal should appear
    const dialog = page.getByRole("dialog", { name: "Create project" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Fill project form
    await dialog.getByLabel("Project name").clear();
    await dialog.getByLabel("Project name").fill("Pat Bathroom Reno");
    await dialog.getByLabel("Site address").fill("300 Project Dr");

    // Select "Active" status
    const statusGroup = dialog.getByRole("group", { name: "Project status" });
    await statusGroup.getByText("Active").click();

    await dialog.getByRole("button", { name: "Create Project" }).click();

    // Should navigate to projects page
    await page.waitForURL("**/projects**", { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// URL Deep-linking
// ---------------------------------------------------------------------------

test.describe("Navigation", () => {
  test("deep-links to customer via URL param", async ({ page }) => {
    const custResult = await quickAddCustomer(authToken, {
      full_name: "Deeplink Dana",
      phone: "555-800-0001",
    });
    const customerId = custResult.customer!.id;

    await loginAndNavigate(
      page,
      session,
      `/customers?customer=${customerId}`,
    );

    // Customer should be highlighted (has highlight CSS class)
    const highlightedRow = page.locator("[class*=gridRowHighlight]");
    await expect(highlightedRow).toBeVisible({ timeout: 10_000 });
    await expect(highlightedRow).toContainText("Deeplink Dana");
  });
});
