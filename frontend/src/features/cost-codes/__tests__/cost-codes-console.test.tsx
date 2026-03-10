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
    capabilities: { cost_codes: ["view", "create"] },
  })),
}));

vi.stubGlobal("fetch", mockFetch);

import { CostCodesConsole } from "../components/cost-codes-console";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCostCode(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: "01-100",
    name: "General Conditions",
    is_active: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: { codes?: unknown[] } = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/cost-codes/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.codes ?? [makeCostCode()] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CostCodesConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders header with title and stats", async () => {
    setupDefaultFetch({ codes: [makeCostCode(), makeCostCode({ id: 2, code: "01-200", is_active: false })] });
    render(<CostCodesConsole />);

    expect(screen.getByText("Cost Codes")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Total 2")).toBeInTheDocument();
    });
    expect(screen.getByText("Active 1")).toBeInTheDocument();
    expect(screen.getByText("Archived 1")).toBeInTheDocument();
  });

  it("loads and displays cost codes from API", async () => {
    setupDefaultFetch({
      codes: [
        makeCostCode({ id: 1, code: "01-100", name: "General Conditions" }),
        makeCostCode({ id: 2, code: "02-200", name: "Framing" }),
      ],
    });
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("01-100")).toBeInTheDocument();
      expect(screen.getByText("02-200")).toBeInTheDocument();
    });
  });

  it("shows error on load failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: "Unauthorized." } }),
    });
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("Unauthorized.")).toBeInTheDocument();
    });
  });

  it("filters cost codes by search term", async () => {
    setupDefaultFetch({
      codes: [
        makeCostCode({ id: 1, code: "01-100", name: "General Conditions" }),
        makeCostCode({ id: 2, code: "02-200", name: "Framing" }),
      ],
    });
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("01-100")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search cost codes"), {
      target: { value: "framing" },
    });

    expect(screen.queryByText("01-100")).not.toBeInTheDocument();
    expect(screen.getByText("02-200")).toBeInTheDocument();
  });

  it("filters by visibility (active vs all)", async () => {
    setupDefaultFetch({
      codes: [
        makeCostCode({ id: 1, code: "01-100", is_active: true }),
        makeCostCode({ id: 2, code: "99-999", name: "Archived Code", is_active: false }),
      ],
    });
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("01-100")).toBeInTheDocument();
    });

    // Default is "Active" — archived should be hidden
    expect(screen.queryByText("99-999")).not.toBeInTheDocument();

    // Switch to "All"
    const allButtons = screen.getAllByRole("button", { name: /All/i });
    const filterButton = allButtons.find(
      (btn) => btn.closest("[role='group']")?.getAttribute("aria-label") === "Cost code visibility filter",
    )!;
    fireEvent.click(filterButton);

    expect(screen.getByText("99-999")).toBeInTheDocument();
  });

  it("selects a cost code and populates the edit form", async () => {
    setupDefaultFetch({
      codes: [
        makeCostCode({ id: 1, code: "01-100", name: "General Conditions" }),
        makeCostCode({ id: 2, code: "02-200", name: "Framing" }),
      ],
    });
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("02-200")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("02-200"));

    expect(screen.getByText("Edit: 02-200")).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue("Framing");
  });

  it("creates a new cost code via POST", async () => {
    setupDefaultFetch({ codes: [] });
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("New Cost Code")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Code/), { target: { value: "03-300" } });
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Electrical" } });

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: makeCostCode({ id: 10, code: "03-300", name: "Electrical" }),
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText(/Created cost code #10/)).toBeInTheDocument();
    });
  });

  it("saves an edited cost code via PATCH", async () => {
    setupDefaultFetch();
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("01-100")).toBeInTheDocument();
    });

    // Auto-selects the first code on load
    expect(screen.getByText("Edit: 01-100")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Updated Name" } });

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: makeCostCode({ name: "Updated Name" }),
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved cost code #1/)).toBeInTheDocument();
    });
  });

  it("switches to create mode with + New button", async () => {
    setupDefaultFetch();
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("Edit: 01-100")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("+ New"));
    expect(screen.getByText("New Cost Code")).toBeInTheDocument();
  });

  it("toggles CSV import section", async () => {
    setupDefaultFetch();
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("CSV Import")).toBeInTheDocument();
    });

    // Click to expand
    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText(/Headers: code,name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("shows empty state when no codes match search", async () => {
    setupDefaultFetch();
    render(<CostCodesConsole />);

    await waitFor(() => {
      expect(screen.getByText("01-100")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search cost codes"), {
      target: { value: "zzz-no-match" },
    });

    expect(screen.getByText("No codes match this search.")).toBeInTheDocument();
  });
});
