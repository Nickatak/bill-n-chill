import { test, expect } from "@playwright/test";
import {
  waitForEmail,
  extractVerificationToken,
} from "../../helpers/mailpit";

const uniqueEmail = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`;

const TEST_PASSWORD = "e2eTestPass99!";

test.describe("Register", () => {
  test("full registration flow: register -> verify -> redirect", async ({
    page,
  }) => {
    const email = uniqueEmail();

    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // Wait for "Check your email" confirmation screen
    await expect(
      page.getByRole("note", { name: "Verification email sent" }),
    ).toBeVisible({ timeout: 10_000 });

    // Retrieve verification token from Mailpit
    const verifyEmail = await waitForEmail(email, {
      subjectContains: "Verify",
    });
    const token = extractVerificationToken(verifyEmail);
    expect(token).toBeTruthy();

    // Verify email
    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText("Email confirmed")).toBeVisible({
      timeout: 10_000,
    });

    // Verification auto-redirects to /customers
    await page.waitForURL("**/customers", { timeout: 10_000 });
  });

  test("short password shows validation error", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page.getByText("Password must be at least 8 characters"),
    ).toBeVisible({ timeout: 5_000 });
  });
});
