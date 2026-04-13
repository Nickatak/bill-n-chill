/**
 * Authenticated API helpers for e2e test data setup.
 *
 * These bypass the UI to create/modify backend state directly,
 * keeping test setup fast and focused.
 */

const API_URL = process.env.API_URL || "http://localhost:8000";

function authHeaders(token: string, contentType = "application/json") {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": contentType,
  };
}

/** Generic authenticated request. Throws on non-2xx. */
async function apiRequest<T = Record<string, unknown>>(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers: authHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

// -- Customers --

export type CreatedCustomer = {
  id: number;
  display_name: string;
  phone: string;
  email: string;
  billing_address: string;
  is_archived: boolean;
};

export type QuickAddResult = {
  customer_intake: Record<string, unknown>;
  customer?: { id: number; display_name: string };
  project?: { id: number; name: string; status: string };
};

/** Create a customer via quick-add endpoint. */
export async function quickAddCustomer(
  token: string,
  data: {
    full_name: string;
    phone: string;
    email?: string;
    create_project?: boolean;
    project_name?: string;
    project_address?: string;
    project_status?: "prospect" | "active";
    initial_contract_value?: string;
    notes?: string;
  },
): Promise<QuickAddResult> {
  return apiRequest<QuickAddResult>(token, "POST", "/customers/quick-add/", data);
}

/** Patch a customer record. */
export async function patchCustomer(
  token: string,
  customerId: number,
  data: Partial<{
    display_name: string;
    phone: string;
    email: string;
    billing_address: string;
    is_archived: boolean;
  }>,
): Promise<CreatedCustomer> {
  return apiRequest<CreatedCustomer>(token, "PATCH", `/customers/${customerId}/`, data);
}

// -- Projects --

export type CreatedProject = {
  id: number;
  name: string;
  status: string;
};

/** Create a project under an existing customer. */
export async function createProject(
  token: string,
  customerId: number,
  data: {
    name?: string;
    site_address?: string;
    status?: "prospect" | "active";
  } = {},
): Promise<{ project: CreatedProject; customer: CreatedCustomer }> {
  return apiRequest(token, "POST", `/customers/${customerId}/projects/`, data);
}

/** Fetch customers list (for verifying state in tests). */
export async function getCustomers(
  token: string,
  query = "",
  page = 1,
): Promise<{ data: CreatedCustomer[]; pagination_metadata: { total_count: number } }> {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("q", query);
  const res = await fetch(`${API_URL}/api/v1/customers/?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`GET /customers/ failed: ${res.status}`);
  return res.json();
}
