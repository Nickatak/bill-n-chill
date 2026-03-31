import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "owner@test.com",
    authMessage: "Authenticated.",
    role: "owner",
    organization: null,
    capabilities: { quotes: ["view", "create", "send", "approve"] },
  })),
}));

vi.mock("@/shared/session/rbac", () => ({
  canDo: vi.fn((_caps: unknown, resource: string) => {
    if (resource === "quotes") return true;
    return false;
  }),
}));

vi.mock("@/shared/shell/printable-context", () => ({
  usePrintable: vi.fn(() => ({ isPrintable: false, setPrintable: vi.fn() })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, replace: vi.fn(), back: vi.fn() })),
  useSearchParams: vi.fn(() => mockSearchParams),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => {
    const { href, ...rest } = props;
    return <a href={String(href ?? "")} {...rest}>{children as React.ReactNode}</a>;
  },
}));

vi.mock("../components/quotes-workspace-panel", () => ({
  QuotesWorkspacePanel: (props: Record<string, unknown>) => (
    <div data-testid="workspace-panel">
      {props.workspaceBadgeLabel ? (
        <span>{String(props.workspaceBadgeLabel)}</span>
      ) : null}
      {!props.canMutateQuotes && (
        <p>Role `{String(props.role)}` can view quotes but cannot create or update.</p>
      )}
    </div>
  ),
}));

vi.stubGlobal("fetch", mockFetch);

import { QuotesConsole } from "../components/quotes-console";
import { policyContract } from "./fixtures";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: "Kitchen Remodel",
    customer_display_name: "Jane Smith",
    status: "active",
    contract_value_original: "100000.00",
    contract_value_current: "100000.00",
    ...overrides,
  };
}

function makeQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    project: 7,
    version: 1,
    family_key: "1",
    status: "draft",
    title: "Foundation Work",
    subtotal: "5000.00",
    tax_percent: "0",
    grand_total: "5000.00",
    valid_through: "2026-04-01",
    terms_text: "",
    notes_text: "",
    quote_date: "2026-03-01",
    line_items: [],
    is_active_quote: false,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultFetch(overrides: {
  projects?: unknown[];
  quotes?: unknown[];
  costCodes?: unknown[];
  statusEvents?: unknown[];
} = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/contracts/quotes")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: policyContract }),
      });
    }
    if (url.includes("/status-events")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.statusEvents ?? [] }),
      });
    }
    if (url.includes("/projects/") && url.includes("/quotes")) {
      // Quotes endpoint returns data as direct array
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.quotes ?? [makeQuote()] }),
      });
    }
    if (url.includes("/organization/")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              organization: {
                default_quote_valid_delta: 30,
                quote_terms_and_conditions: "Standard terms",
              },
            },
          }),
      });
    }
    if (url.includes("/projects")) {
      // Projects endpoint returns data as direct array
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.projects ?? [makeProject()] }),
      });
    }
    if (url.includes("/cost-codes")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: overrides.costCodes ?? [] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuotesConsole", () => {
  beforeEach(async () => {
    mockFetch.mockReset();
    // Ensure canDo mock is restored to default (may leak from read-only test)
    const { canDo } = await import("@/shared/session/rbac");
    (canDo as ReturnType<typeof vi.fn>).mockImplementation(
      (_caps: unknown, resource: string) => resource === "quotes",
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders and fetches policy contract on mount", async () => {
    setupDefaultFetch();
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/contracts/quotes"),
        expect.anything(),
      );
    });
  });

  it("fetches and displays project quotes when scoped to a project", async () => {
    setupDefaultFetch();
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/projects/7/quotes"),
        expect.anything(),
      );
    });
  });

  it("loads quotes for the selected project after dependencies resolve", async () => {
    setupDefaultFetch();
    render(<QuotesConsole scopedProjectId={7} />);

    // After loading deps + selecting project, quotes endpoint should be called
    await waitFor(() => {
      const quoteCalls = mockFetch.mock.calls.filter(
        (call) => String(call[0]).includes("/projects/7/quotes"),
      );
      expect(quoteCalls.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  it("renders status filter section with label", async () => {
    setupDefaultFetch();
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText("Quote status filter")).toBeTruthy(),
    );
  });

  it("renders empty state when no quotes exist", async () => {
    setupDefaultFetch({ quotes: [] });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/No quotes yet/i)).toBeTruthy(),
    );
  });

  it("shows read-only hint when user lacks create capability", async () => {
    const { canDo } = await import("@/shared/session/rbac");
    (canDo as ReturnType<typeof vi.fn>).mockReturnValue(false);

    setupDefaultFetch();
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/can view quotes but cannot create/i)).toBeTruthy(),
    );

    // Restore
    (canDo as ReturnType<typeof vi.fn>).mockImplementation(
      (_caps: unknown, resource: string) => resource === "quotes",
    );
  });

  it("displays project name in lifecycle header", async () => {
    setupDefaultFetch({ projects: [makeProject({ id: 7, name: "Kitchen Remodel" })] });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() =>
      expect(screen.getByText(/Quotes for: Kitchen Remodel/)).toBeTruthy(),
    );
  });

  it("fetches cost codes for the project", async () => {
    setupDefaultFetch();
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/cost-codes"),
        expect.anything(),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Action buttons & confirmation panel
  // ---------------------------------------------------------------------------

  it("shows action buttons for a draft quote", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "draft" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Click the family card to select the quote
    const familyCard = screen.getByText("Foundation Work").closest("[role='button']")!;
    fireEvent.click(familyCard);

    await waitFor(() => {
      // Policy fixture allows draft → sent only
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows confirmation panel when Send to Customer is clicked", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "draft" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    expect(screen.getByText(/Send Foundation Work v1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm Send to Customer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows no-email notice in confirmation when customer has no email", async () => {
    setupDefaultFetch({
      quotes: [
        makeQuote({
          id: 42,
          status: "draft",
          project_context: {
            id: 7,
            name: "Kitchen Remodel",
            status: "active",
            customer_display_name: "Jane Smith",
            customer_email: "",
          },
        }),
      ],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    expect(screen.getByText(/No email on file/)).toBeInTheDocument();
  });

  it("shows email notice in confirmation when customer has email", async () => {
    setupDefaultFetch({
      projects: [makeProject({ customer_email: "jane@example.com" })],
      quotes: [
        makeQuote({
          id: 42,
          status: "draft",
          project_context: {
            id: 7,
            name: "Kitchen Remodel",
            status: "active",
            customer_display_name: "Jane Smith",
            customer_email: "jane@example.com",
          },
        }),
      ],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    const checkbox = screen.getByRole("checkbox", { name: /email customer/i });
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument();
  });

  it("closes confirmation panel when Cancel is clicked", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "draft" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));
    expect(screen.getByText(/Send Foundation Work v1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Send Foundation Work v1/)).not.toBeInTheDocument();
  });

  it("shows Re-send and Mark Approved buttons for a sent quote", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "sent" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      // Policy fixture allows sent → approved, rejected
      expect(screen.getByRole("button", { name: "Mark Approved" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mark Rejected" })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows no action buttons for an approved quote", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "approved" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    // Approved is terminal — no action buttons should appear
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Send to Customer" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Void Quote" })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Confirm action → PATCH + success message
  // ---------------------------------------------------------------------------

  it("sends PATCH and shows success message on confirm send", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "draft", public_ref: "foundation-work--abc123" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    // Mock the PATCH response
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: makeQuote({ id: 42, status: "sent", public_ref: "foundation-work--abc123", sender_name: "Test Org" }),
            email_sent: true,
          }),
        });
      }
      // Status events reload
      if (String(url).includes("/status-events")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Send to Customer" }));

    await waitFor(() => {
      expect(screen.getByText(/Sent Foundation Work v1/)).toBeInTheDocument();
    }, { timeout: 3000 });

    // Confirmation panel should be closed
    expect(screen.queryByText(/Send Foundation Work v1/)).not.toBeInTheDocument();

    // Verify PATCH was called with correct body
    const patchCall = mockFetch.mock.calls.find(
      (call: unknown[]) => (call[1] as RequestInit)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const patchBody = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(patchBody.status).toBe("sent");
  });

  it("shows success message on confirm mark approved", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "sent" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark Approved" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Mark Approved" }));
    expect(screen.getByText(/Mark Foundation Work v1 as approved/)).toBeInTheDocument();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: makeQuote({ id: 42, status: "approved" }),
          }),
        });
      }
      if (String(url).includes("/status-events")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Mark Approved" }));

    await waitFor(() => {
      expect(screen.getByText(/Marked Foundation Work v1 as approved/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows error message on confirm when PATCH fails", async () => {
    setupDefaultFetch({
      quotes: [makeQuote({ id: 42, status: "draft" })],
    });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("Foundation Work")).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByText("Foundation Work").closest("[role='button']")!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
    }, { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "Send to Customer" }));

    mockFetch.mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({
            error: { message: "Invalid status transition." },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Send to Customer" }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid status transition/)).toBeInTheDocument();
    }, { timeout: 3000 });

    // Confirmation panel should remain open on error
    expect(screen.getByRole("button", { name: "Confirm Send to Customer" })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Terminal project guards
  // -------------------------------------------------------------------------

  it("shows read-only workspace when project is cancelled", async () => {
    setupDefaultFetch({ projects: [makeProject({ status: "cancelled" })] });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("READ-ONLY")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("shows read-only workspace when project is completed", async () => {
    setupDefaultFetch({ projects: [makeProject({ status: "completed" })] });
    render(<QuotesConsole scopedProjectId={7} />);

    await waitFor(() => {
      expect(screen.getByText("READ-ONLY")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
