export const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

export async function fetchIntakeAuthMe({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/auth/me/`, {
    headers: { Authorization: `Token ${token}` },
  });
  return response;
}

export async function postQuickAddCustomerIntake({
  baseUrl,
  token,
  body,
}: {
  baseUrl: string;
  token: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/customers/quick-add/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(body),
  });
  return response;
}
