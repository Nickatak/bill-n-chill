/**
 * Shared authentication helpers for e2e tests.
 *
 * Provides API-level register + verify + login so tests can get an
 * authenticated session without going through the UI every time.
 */

import type { Page } from "@playwright/test";
import { waitForEmail, extractVerificationToken } from "./mailpit";

const API_URL = process.env.API_URL || "http://localhost:8000";

/** Shape matching the frontend's localStorage session (bnc-session-v1). */
export type E2ESession = {
  token: string;
  email: string;
  role: string;
  organization?: {
    id: number;
    displayName: string;
    onboardingCompleted: boolean;
  };
  capabilities?: Record<string, string[]>;
  isSuperuser: boolean;
};

/** Generate a unique email for test isolation. */
export const uniqueEmail = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`;

const DEFAULT_PASSWORD = "e2eTestPass99!";

/**
 * Register a user, verify via Mailpit, and log in via API.
 * Returns the auth token and the session object ready for localStorage injection.
 */
export async function registerAndLogin(
  email = uniqueEmail(),
  password = DEFAULT_PASSWORD,
): Promise<{ token: string; session: E2ESession }> {
  // 1. Register
  const regRes = await fetch(`${API_URL}/api/v1/auth/register/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!regRes.ok) {
    throw new Error(`Register failed: ${regRes.status} ${await regRes.text()}`);
  }

  // 2. Verify via Mailpit
  const mail = await waitForEmail(email, { subjectContains: "Verify" });
  const verifyToken = extractVerificationToken(mail);

  await fetch(`${API_URL}/api/v1/auth/verify-email/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: verifyToken }),
  });

  // 3. Login
  const loginRes = await fetch(`${API_URL}/api/v1/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  }

  const { data } = await loginRes.json();

  const session: E2ESession = {
    token: data.token,
    email: data.user.email,
    role: data.user.role,
    organization: data.organization
      ? {
          id: data.organization.id,
          displayName: data.organization.display_name,
          onboardingCompleted: data.organization.onboarding_completed ?? false,
        }
      : undefined,
    capabilities: data.capabilities,
    isSuperuser: data.user.is_superuser ?? false,
  };

  return { token: data.token, session };
}

/**
 * Inject an authenticated session into the page's localStorage
 * and navigate to the target route.
 */
export async function loginAndNavigate(
  page: Page,
  session: E2ESession,
  path = "/customers",
): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: "bnc-session-v1", value: JSON.stringify(session) },
  );
  await page.goto(path);
}
