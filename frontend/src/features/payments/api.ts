export const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, "");
}

export async function fetchPaymentPolicyContract({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string;
}) {
  const response = await fetch(`${normalizeApiBaseUrl(baseUrl)}/contracts/payments/`, {
    headers: { Authorization: `Token ${token}` },
  });
  return response;
}
