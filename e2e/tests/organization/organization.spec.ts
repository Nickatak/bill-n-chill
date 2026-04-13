import { test, expect } from "@playwright/test";
import {
  registerAndLogin,
  loginAndNavigate,
  type E2ESession,
} from "../../helpers/auth";
import { clearMailbox } from "../../helpers/mailpit";

/**
 * Organization page e2e tests.
 *
 * Covers all three primary tabs: My Business, Document Settings (Docs),
 * and My Team. Each tab is a separate describe block.
 *
 * All tests share a single authenticated user (owner role, auto-bootstrapped org).
 */

let authToken: string;
let session: E2ESession;

test.beforeAll(async () => {
  await clearMailbox();
  const result = await registerAndLogin();
  authToken = result.token;
  session = result.session;
});

const ORG_PATH = "/ops/organization";

// ---------------------------------------------------------------------------
// Business Tab
// ---------------------------------------------------------------------------

test.describe("Business Tab", () => {
  test("displays org profile fields and edits company name", async ({
    page,
  }) => {
    await loginAndNavigate(page, session, ORG_PATH);

    // Business tab should be the default
    await expect(page.getByLabel("Company Name")).toBeVisible({
      timeout: 10_000,
    });

    // Edit company name
    await page.getByLabel("Company Name").clear();
    await page.getByLabel("Company Name").fill("Test Construction LLC");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 5_000 });
  });

  test("edits contact info fields", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await expect(page.getByLabel("Company Name")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel("Phone").fill("555-999-0001");
    await page.getByLabel("Website").fill("https://testconstruction.com");
    await page.getByLabel("Help / Support Email").fill("help@test.com");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 5_000 });

    // Verify persistence by reloading
    await page.reload();
    await expect(page.getByLabel("Phone")).toHaveValue("555-999-0001", {
      timeout: 10_000,
    });
    await expect(page.getByLabel("Website")).toHaveValue(
      "https://testconstruction.com",
    );
  });

  test("edits billing address fields", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await expect(page.getByLabel("Company Name")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel("Street Address", { exact: true }).fill("100 Builder Blvd");
    await page.getByLabel("City").fill("Testville");
    await page.getByLabel("State").fill("CA");
    await page.getByLabel("ZIP").fill("90210");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 5_000 });
  });

  test("edits license and tax fields", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await expect(page.getByLabel("Company Name")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel("Contractor License #").fill("CSLB #9999999");
    await page.getByLabel("Tax ID / EIN").fill("99-9999999");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 5_000 });
  });

  test("save button disabled when no changes made", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await expect(page.getByLabel("Company Name")).toBeVisible({
      timeout: 10_000,
    });

    // Without making changes, save should be disabled
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Document Settings Tab (Docs)
// ---------------------------------------------------------------------------

test.describe("Document Settings Tab", () => {
  test("edits quote valid days and terms", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);

    // Switch to Docs tab
    await page.getByRole("button", { name: "Docs" }).click();

    // Default sub-tab should be Quotes
    await expect(page.getByLabel("Quote Valid Days")).toBeVisible({
      timeout: 5_000,
    });

    await page.getByLabel("Quote Valid Days").clear();
    await page.getByLabel("Quote Valid Days").fill("45");
    await page
      .getByLabel("Quote Terms & Conditions")
      .fill("Valid for 45 days from date of issue.");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 5_000 });
  });

  test("edits invoice due days and terms", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Docs" }).click();

    // Switch to Invoices sub-tab
    await page.getByRole("button", { name: "Invoices" }).click();

    await expect(page.getByLabel("Default Due Days")).toBeVisible({
      timeout: 5_000,
    });

    await page.getByLabel("Default Due Days").clear();
    await page.getByLabel("Default Due Days").fill("30");
    await page
      .getByLabel("Invoice Terms & Conditions")
      .fill("Net 30. Late fee of 1.5% per month.");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 5_000 });
  });

  test("edits change order terms", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Docs" }).click();

    // Switch to Change Orders sub-tab
    await page.getByRole("button", { name: "Change Orders" }).click();

    await expect(
      page.getByLabel("Change Order Terms & Conditions"),
    ).toBeVisible({ timeout: 5_000 });

    await page
      .getByLabel("Change Order Terms & Conditions")
      .fill("All change orders require written approval.");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 5_000 });
  });

  test("switches between doc type sub-tabs", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Docs" }).click();

    // Quotes tab (default)
    await expect(page.getByLabel("Quote Valid Days")).toBeVisible({
      timeout: 5_000,
    });

    // Switch to Invoices
    await page.getByRole("button", { name: "Invoices" }).click();
    await expect(page.getByLabel("Default Due Days")).toBeVisible();
    await expect(page.getByLabel("Quote Valid Days")).not.toBeVisible();

    // Switch to Change Orders
    await page.getByRole("button", { name: "Change Orders" }).click();
    await expect(
      page.getByLabel("Change Order Terms & Conditions"),
    ).toBeVisible();
    await expect(page.getByLabel("Default Due Days")).not.toBeVisible();

    // Back to Quotes
    await page.getByRole("button", { name: "Quotes" }).click();
    await expect(page.getByLabel("Quote Valid Days")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Team Tab
// ---------------------------------------------------------------------------

test.describe("Team Tab", () => {
  test("displays current user with You badge", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Team" }).click();

    // Table should render with current user
    await expect(page.getByRole("columnheader", { name: "Member" })).toBeVisible({
      timeout: 10_000,
    });

    // Current user row has "You" badge
    await expect(page.getByText("You", { exact: true })).toBeVisible();
  });

  test("self-edit is blocked (no save button on own row)", async ({
    page,
  }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Team" }).click();

    await expect(page.getByText("You", { exact: true })).toBeVisible({ timeout: 10_000 });

    // The current user's row should not have a save button
    const selfRow = page.locator("tr").filter({ hasText: "You" });
    await expect(selfRow.getByRole("button", { name: "Save" })).not.toBeVisible();

    // Role should be displayed as text, not a dropdown
    await expect(selfRow.getByRole("combobox")).not.toBeVisible();
  });

  test("creates invite, shows invite link banner", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Team" }).click();

    await expect(page.getByText("Invite Members")).toBeVisible({
      timeout: 10_000,
    });

    // Fill invite form
    const inviteEmail = `invite-${Date.now()}@test.com`;
    await page.getByLabel("Email").fill(inviteEmail);

    await page.getByRole("button", { name: "Create Invite" }).click();

    // Invite link banner should appear
    await expect(
      page.getByText("Invite Link (copy and share)"),
    ).toBeVisible({ timeout: 10_000 });

    // Banner should contain a code element with the invite URL
    await expect(page.locator("code")).toContainText("/register?token=");

    // Invite should appear in pending list
    await expect(page.getByText("Pending Invites")).toBeVisible();
    await expect(page.getByText(inviteEmail)).toBeVisible();
  });

  test("revokes a pending invite", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Team" }).click();

    await expect(page.getByText("Invite Members")).toBeVisible({
      timeout: 10_000,
    });

    // Create an invite to revoke
    const revokeEmail = `revoke-${Date.now()}@test.com`;
    await page.getByLabel("Email").fill(revokeEmail);
    await page.getByRole("button", { name: "Create Invite" }).click();

    // Wait for it to appear in pending list
    await expect(page.getByText(revokeEmail)).toBeVisible({
      timeout: 10_000,
    });

    // Revoke it
    const inviteRow = page.locator("article").filter({ hasText: revokeEmail });
    await inviteRow.getByRole("button", { name: "Revoke" }).click();

    // Invite should disappear
    await expect(page.getByText(revokeEmail)).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("duplicate invite is rejected", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Team" }).click();

    await expect(page.getByText("Invite Members")).toBeVisible({
      timeout: 10_000,
    });

    // Create first invite
    const dupeEmail = `dupe-invite-${Date.now()}@test.com`;
    await page.getByLabel("Email").fill(dupeEmail);
    await page.getByRole("button", { name: "Create Invite" }).click();
    await expect(page.getByText(dupeEmail)).toBeVisible({ timeout: 10_000 });

    // Try to create the same invite again
    await page.getByLabel("Email").fill(dupeEmail);
    await page.getByRole("button", { name: "Create Invite" }).click();

    // Should show error about existing invite
    await expect(
      page.getByText(/pending invite already exists/i),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Notifications Tab
// ---------------------------------------------------------------------------

test.describe("Notifications Tab", () => {
  test("displays push notification section", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);
    await page.getByRole("button", { name: "Notifications" }).click();

    // Push notifications section renders
    await expect(page.getByText("Push Notifications")).toBeVisible({
      timeout: 5_000,
    });

    // In headless Chromium, permission is denied/unsupported — should show appropriate message
    await expect(
      page.getByText(/not supported|permission has been blocked/i),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Tab Navigation
// ---------------------------------------------------------------------------

test.describe("Tab Navigation", () => {
  test("switches between all tabs", async ({ page }) => {
    await loginAndNavigate(page, session, ORG_PATH);

    // Start on Business (default)
    await expect(page.getByLabel("Company Name")).toBeVisible({
      timeout: 10_000,
    });

    // Switch to Docs
    await page.getByRole("button", { name: "Docs" }).click();
    await expect(page.getByLabel("Quote Valid Days")).toBeVisible({
      timeout: 5_000,
    });

    // Switch to Team
    await page.getByRole("button", { name: "Team" }).click();
    await expect(
      page.getByRole("columnheader", { name: "Member" }),
    ).toBeVisible({ timeout: 5_000 });

    // Switch to Notifications
    await page.getByRole("button", { name: "Notifications" }).click();
    await expect(page.getByText("Push Notifications")).toBeVisible({
      timeout: 5_000,
    });

    // Back to Business
    await page.getByRole("button", { name: "Business" }).click();
    await expect(page.getByLabel("Company Name")).toBeVisible({
      timeout: 5_000,
    });
  });
});
