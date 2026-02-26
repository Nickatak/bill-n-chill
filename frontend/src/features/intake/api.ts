import { buildAuthHeaders } from "@/features/session/auth-headers";

export const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
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
    headers: buildAuthHeaders(token, { contentType: "application/json" }),
    body: JSON.stringify(body),
  });
  return response;
}
