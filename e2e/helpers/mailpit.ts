/**
 * Mailpit HTTP API helpers for e2e tests.
 *
 * Mailpit captures all SMTP traffic from the Docker Compose stack.
 * We query its API to retrieve verification tokens, password-reset
 * links, etc. without needing direct database access.
 *
 * API docs: https://mailpit.axllent.org/docs/api-v1/
 */

const MAILPIT_URL = process.env.MAILPIT_URL || "http://localhost:8025";

interface MailpitMessage {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Created: string;
  Snippet: string;
}

interface MailpitMessageList {
  total: number;
  messages: MailpitMessage[];
}

interface MailpitMessageDetail {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Text: string;
  HTML: string;
}

/**
 * Wait for an email to arrive for a given recipient address.
 * Polls Mailpit every second up to `timeoutMs`.
 */
export async function waitForEmail(
  toAddress: string,
  options: { subjectContains?: string; timeoutMs?: number } = {},
): Promise<MailpitMessageDetail> {
  const { subjectContains, timeoutMs = 15_000 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(toAddress)}`,
    );
    if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);

    const data: MailpitMessageList = await res.json();

    const match = data.messages.find(
      (m) => !subjectContains || m.Subject.includes(subjectContains),
    );

    if (match) {
      const detail = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      if (!detail.ok)
        throw new Error(`Mailpit message fetch failed: ${detail.status}`);
      return detail.json();
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(
    `Timed out waiting for email to ${toAddress}` +
      (subjectContains ? ` (subject containing "${subjectContains}")` : ""),
  );
}

/**
 * Extract a verification token from an email body.
 * Looks for a `/verify-email?token=<token>` link.
 */
export function extractVerificationToken(email: MailpitMessageDetail): string {
  const pattern = /verify-email\?token=([A-Za-z0-9_-]+)/;
  const match = email.Text.match(pattern) || email.HTML.match(pattern);
  if (!match) {
    throw new Error(
      "Could not find verification token in email body.\n" +
        `Text: ${email.Text.slice(0, 500)}`,
    );
  }
  return match[1];
}

/**
 * Extract a password-reset token from an email body.
 * Looks for a `/reset-password?token=<token>` link.
 */
export function extractPasswordResetToken(
  email: MailpitMessageDetail,
): string {
  const pattern = /reset-password\?token=([A-Za-z0-9_-]+)/;
  const match = email.Text.match(pattern) || email.HTML.match(pattern);
  if (!match) {
    throw new Error(
      "Could not find password-reset token in email body.\n" +
        `Text: ${email.Text.slice(0, 500)}`,
    );
  }
  return match[1];
}

/** Delete all messages in Mailpit. Call in test setup for isolation. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}
