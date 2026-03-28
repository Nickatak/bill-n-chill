import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "nick@test.com",
    authMessage: "Using shared session for nick@test.com (owner).",
    role: "owner",
    organization: null,
    capabilities: { vendors: ["view", "create"] },
  })),
}));

vi.stubGlobal("fetch", mockFetch);

import { VendorsConsole } from "../components/vendors-console";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeVendor(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Acme Supply",
    email: "acme@example.com",
    phone: "5551234567",
    tax_id_last4: "1234",
    notes: "",
    created_at: "2026-01-15T10:00:00Z",
    updated_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: { vendors?: unknown[] } = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/vendors/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.vendors ?? [makeVendor()] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VendorsConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads and displays vendors from API", async () => {
    setupDefaultFetch({
      vendors: [
        makeVendor({ id: 1, name: "Acme Supply" }),
        makeVendor({ id: 2, name: "BuildMart" }),
      ],
    });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Acme Supply/)).toBeInTheDocument();
      expect(screen.getByText(/BuildMart/)).toBeInTheDocument();
    });
  });

  it("shows error on load failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: "Forbidden." } }),
    });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText("Forbidden.")).toBeInTheDocument();
    });
  });

  it("filters vendors by search term", async () => {
    setupDefaultFetch({
      vendors: [
        makeVendor({ id: 1, name: "Acme Supply" }),
        makeVendor({ id: 2, name: "BuildMart" }),
      ],
    });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Acme Supply/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search or add a vendor"), {
      target: { value: "buildmart" },
    });

    await waitFor(() => {
      expect(screen.queryByText(/Acme Supply/)).not.toBeInTheDocument();
      expect(screen.getByText(/BuildMart/)).toBeInTheDocument();
    });
  });

  it("shows all vendors without activity filtering", async () => {
    setupDefaultFetch({
      vendors: [
        makeVendor({ id: 1, name: "Vendor A" }),
        makeVendor({ id: 2, name: "Vendor B" }),
      ],
    });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Vendor A/)).toBeInTheDocument();
      expect(screen.getByText(/Vendor B/)).toBeInTheDocument();
    });
  });

  it("selects a vendor and populates the edit form", async () => {
    setupDefaultFetch();
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Acme Supply/)).toBeInTheDocument();
    });

    // Click the vendor row
    fireEvent.click(screen.getByText(/Acme Supply/).closest("tr")!);

    expect(screen.getByText("Edit: Acme Supply")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Acme Supply");
    expect(screen.getByLabelText("Email")).toHaveValue("acme@example.com");
  });

  it("creates a new vendor via quick-add", async () => {
    setupDefaultFetch({ vendors: [] });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByLabelText("Search or add a vendor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search or add a vendor"), { target: { value: "New Vendor Co" } });

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: makeVendor({ id: 20, name: "New Vendor Co" }),
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText(/Created vendor "New Vendor Co"/)).toBeInTheDocument();
    });
  });

  it("saves an edited vendor via PATCH", async () => {
    setupDefaultFetch();
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Acme Supply/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Acme Supply/).closest("tr")!);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme Updated" } });

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: makeVendor({ name: "Acme Updated" }),
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved vendor #1/)).toBeInTheDocument();
    });
  });

  it("handles duplicate detection on create (409)", async () => {
    setupDefaultFetch({ vendors: [] });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByLabelText("Search or add a vendor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search or add a vendor"), { target: { value: "Acme Supply" } });

    // POST returns 409 — duplicate name is blocked outright (no override)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          error: {
            code: "duplicate_detected",
            message: 'A vendor with this name already exists. To distinguish them, add a location or qualifier (e.g. "ABC Plumbing — Westside").',
          },
          data: {
            duplicate_candidates: [makeVendor({ id: 99, name: "Acme Supply" })],
          },
        }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText(/A vendor with this name already exists/)).toBeInTheDocument();
    });
  });

  it("shows pagination when vendors exceed page size", async () => {
    const vendors = Array.from({ length: 8 }, (_, i) =>
      makeVendor({ id: i + 1, name: `Vendor ${i + 1}` }),
    );
    setupDefaultFetch({ vendors });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });

  it("deselects vendor to return to browse mode", async () => {
    setupDefaultFetch();
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/Acme Supply/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Acme Supply/).closest("tr")!);
    expect(screen.getByText("Edit: Acme Supply")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Deselect"));
    expect(screen.queryByText("Edit: Acme Supply")).not.toBeInTheDocument();
  });

  it("shows empty state when no vendors exist", async () => {
    setupDefaultFetch({ vendors: [] });
    render(<VendorsConsole />);

    await waitFor(() => {
      expect(screen.getByText(/No vendors yet/)).toBeInTheDocument();
    });
  });
});
