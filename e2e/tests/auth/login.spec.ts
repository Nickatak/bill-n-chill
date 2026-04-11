import { test, expect } from "@playwright/test";
import {
  waitForEmail,
  extractVerificationToken,
} from "../../helpers/mailpit";

const uniqueEmail = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`;

const TEST_PASSWORD = "e2eTestPass99!";
const API_URL = process.env.API_URL || "http://localhost:8000";

/**
 * Register + verify a user via API and Mailpit so login tests
 * start with a known-good account without repeating UI registration.
 */
async function registerVerifiedUser(
  email: string,
  password: string,
): Promise<void> {
  // Register via API
  await fetch(`${API_URL}/api/v1/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  // Retrieve verification token from Mailpit
  const mail = await waitForEmail(email, { subjectContains: "Verify" });
  const token = extractVerificationToken(mail);

  // Verify via API
  await fetch(`${API_URL}/api/v1/auth/verify-email/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

test.describe("Login", () => {
  test("login with verified account redirects to /customers", async ({
    page,
  }) => {
    const email = uniqueEmail();
    await registerVerifiedUser(email, TEST_PASSWORD);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("**/customers", { timeout: 10_000 });
  });

  test("wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid username/password")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("unverified user cannot log in", async ({ page }) => {
    const email = uniqueEmail();

    // Register but don't verify
    await page.goto("/register");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByRole("note", { name: "Verification email sent" }),
    ).toBeVisible({ timeout: 10_000 });

    // Try to log in without verifying
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(
      page.getByText("Please verify your email before signing in"),
    ).toBeVisible({ timeout: 5_000 });

    // Resend button should appear
    await expect(
      page.getByRole("button", { name: "Resend verification email" }),
    ).toBeVisible();
  });
});
