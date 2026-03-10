import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "nick@test.com",
    authMessage: "Using shared session for nick@test.com (owner).",
    role: "owner",
    organization: null,
    capabilities: { customers: ["view", "create"] },
  })),
}));

vi.stubGlobal("fetch", mockFetch);

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

import { QuickAddConsole } from "../components/quick-add-console";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillCustomerFields(name: string, phone: string) {
  fireEvent.change(screen.getByLabelText("Full name"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Phone (or email)"), {
    target: { value: phone },
  });
}

function fillProjectFields(address: string, projectName?: string) {
  if (projectName) {
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: projectName },
    });
  }
  fireEvent.change(screen.getByLabelText("Project address"), {
    target: { value: address },
  });
}

function clickSubmit(buttonName: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
}

function successResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: {
          customer_intake: {
            id: 1,
            full_name: "Jane Doe",
            phone: "5551234567",
            project_address: "123 Main St",
            email: "",
            notes: "",
            source: "field_manual",
            created_at: "2026-01-15T10:00:00Z",
          },
          customer: { id: 10, display_name: "Jane Doe" },
          project: null,
          ...overrides,
        },
        meta: { duplicate_resolution: "none", customer_created: true },
      }),
  };
}

function successWithProjectResponse() {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: {
          customer_intake: {
            id: 1,
            full_name: "Jane Doe",
            phone: "5551234567",
            project_address: "123 Main St",
            email: "",
            notes: "",
            source: "field_manual",
            created_at: "2026-01-15T10:00:00Z",
          },
          customer: { id: 10, display_name: "Jane Doe" },
          project: { id: 5, name: "Jane Doe Project", status: "prospect" },
        },
        meta: { duplicate_resolution: "none", customer_created: true },
      }),
  };
}

function duplicateResponse() {
  return {
    ok: false,
    status: 409,
    json: () =>
      Promise.resolve({
        error: { code: "duplicate_detected", message: "Possible duplicate found." },
        data: {
          duplicate_candidates: [
            {
              id: 99,
              display_name: "Jane Doe",
              phone: "5551234567",
              email: "jane@example.com",
              billing_address: "123 Main St",
              created_at: "2025-06-01T12:00:00Z",
            },
          ],
          allowed_resolutions: ["use_existing", "create_anyway"],
        },
      }),
  };
}

function apiErrorResponse(message = "Something went wrong.") {
  return {
    ok: false,
    status: 400,
    json: () =>
      Promise.resolve({
        error: { message },
      }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuickAddConsole", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the form with intro text", () => {
    render(<QuickAddConsole />);
    expect(screen.getByText(/Add a customer in under a minute/)).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone (or email)")).toBeInTheDocument();
  });

  it("shows validation errors on empty submission", async () => {
    render(<QuickAddConsole />);
    // Use fireEvent.submit to bypass native `required` attribute validation
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByText(/fix the required fields/i)).toBeInTheDocument();
    });
  });

  it("shows success message on customer_only submission", async () => {
    mockFetch.mockResolvedValueOnce(successResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer only/i);

    await waitFor(() => {
      expect(screen.getByText("Customer created.")).toBeInTheDocument();
    });
  });

  it("shows success message on customer_and_project submission", async () => {
    mockFetch.mockResolvedValueOnce(successWithProjectResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    fillProjectFields("123 Main St", "Jane Doe Project");
    clickSubmit(/save customer \+ start project/i);

    await waitFor(() => {
      expect(screen.getByText("Customer + project created.")).toBeInTheDocument();
    });
  });

  it("clears form fields after successful submission", async () => {
    mockFetch.mockResolvedValueOnce(successResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer only/i);

    await waitFor(() => {
      expect(screen.getByText("Customer created.")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Full name")).toHaveValue("");
    expect(screen.getByLabelText("Phone (or email)")).toHaveValue("");
  });

  it("shows duplicate resolution panel on 409", async () => {
    mockFetch.mockResolvedValueOnce(duplicateResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    fillProjectFields("123 Main St", "Jane Doe Project");
    clickSubmit(/save customer \+ start project/i);

    await waitFor(() => {
      expect(screen.getByText("Customer already exists")).toBeInTheDocument();
      expect(screen.getByLabelText("Duplicate resolution")).toBeInTheDocument();
    });
  });

  it("resolves duplicate with use_existing and shows success", async () => {
    // First call: duplicate detected
    mockFetch.mockResolvedValueOnce(duplicateResponse());
    // Second call: resolution succeeds
    mockFetch.mockResolvedValueOnce(successWithProjectResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    fillProjectFields("123 Main St", "Jane Doe Project");
    clickSubmit(/save customer \+ start project/i);

    await waitFor(() => {
      expect(screen.getByText("Customer already exists")).toBeInTheDocument();
    });

    // Target the actual <button>, not the <article role="button"> wrapper
    const resolveButtons = screen.getAllByRole("button", { name: /use customer \+ start project/i });
    const actualButton = resolveButtons.find((el) => el.tagName === "BUTTON")!;
    fireEvent.click(actualButton);

    await waitFor(() => {
      expect(screen.getByText("Customer + project created.")).toBeInTheDocument();
    });
  });

  it("shows error message on API failure", async () => {
    mockFetch.mockResolvedValueOnce(apiErrorResponse("Email is required."));

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer only/i);

    await waitFor(() => {
      expect(screen.getByText("Email is required.")).toBeInTheDocument();
    });
  });

  it("shows error message on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer only/i);

    await waitFor(() => {
      expect(screen.getByText(/unexpected UI error/)).toBeInTheDocument();
    });
  });

  it("calls onCustomerCreated callback after success", async () => {
    const onCreated = vi.fn();
    mockFetch.mockResolvedValueOnce(successResponse());

    render(<QuickAddConsole onCustomerCreated={onCreated} />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer only/i);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledOnce();
    });
  });
});
