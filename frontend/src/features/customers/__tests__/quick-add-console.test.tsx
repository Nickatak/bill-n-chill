import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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

import { QuickAddConsole } from "../components/quick-add/quick-add-console";

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
          allowed_resolutions: ["use_existing"],
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

  it("shows validation errors on empty submission", () => {
    render(<QuickAddConsole />);
    clickSubmit(/save customer only/i);

    expect(screen.getByText(/fix the required fields/i)).toBeInTheDocument();
    expect(screen.getByText("Full name is required.")).toBeInTheDocument();
    expect(
      screen.getByText("Provide a valid phone number or email address."),
    ).toBeInTheDocument();
  });

  it("shows field error for empty phone when name is provided", () => {
    render(<QuickAddConsole />);
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Jane Doe" },
    });
    clickSubmit(/save customer only/i);

    expect(
      screen.getByText("Provide a valid phone number or email address."),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows project field errors on customer+project submission with empty project fields", () => {
    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer \+ start project/i);

    expect(
      screen.getByText("Project name is required when creating a project."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Project address is required when creating a project."),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
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

  // ---------------------------------------------------------------------------
  // Optional quick-add fields (contract value, notes, status pills)
  // ---------------------------------------------------------------------------

  it("sends optional fields in POST body when filled", async () => {
    mockFetch.mockResolvedValueOnce(successWithProjectResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    fillProjectFields("123 Main St", "Jane Doe Project");

    // Open the optional details section (jsdom needs explicit open attribute)
    const details = screen.getByText("Optional details").closest("details")!;
    details.setAttribute("open", "");

    // Fill ballpark and notes
    const ballparkInput = details.querySelector<HTMLInputElement>("input[name='initial_contract_value']")!;
    fireEvent.change(ballparkInput, { target: { value: "25000" } });
    const notesTextarea = details.querySelector<HTMLTextAreaElement>("textarea[name='notes']")!;
    fireEvent.change(notesTextarea, { target: { value: "Kitchen remodel, budget flexible" } });

    // Switch status pill to Active
    fireEvent.click(within(details).getByRole("button", { name: "Active" }));

    clickSubmit(/save customer \+ start project/i);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [, fetchOptions] = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.initial_contract_value).toBe("25000");
    expect(body.notes).toBe("Kitchen remodel, budget flexible");
    expect(body.project_status).toBe("active");
  });

  it("sends correct defaults for optional fields when left empty", async () => {
    mockFetch.mockResolvedValueOnce(successResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer only/i);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [, fetchOptions] = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.initial_contract_value).toBeNull();
    expect(body.notes).toBe("");
    expect(body.project_status).toBe("prospect");
  });

  it("status pill toggle sends the selected value to the API", async () => {
    mockFetch.mockResolvedValueOnce(successWithProjectResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    fillProjectFields("123 Main St", "Jane Doe Project");

    // Open optional details (jsdom needs explicit open attribute) — default is "Prospect"
    const details = screen.getByText("Optional details").closest("details")!;
    details.setAttribute("open", "");

    const pillGroup = details.querySelector("[role='group']")!;
    const buttons = Array.from(pillGroup.querySelectorAll<HTMLButtonElement>("button"));
    const prospectButton = buttons.find((b) => b.textContent === "Prospect")!;
    const activeButton = buttons.find((b) => b.textContent === "Active")!;
    expect(prospectButton.getAttribute("aria-pressed")).toBe("true");
    expect(activeButton.getAttribute("aria-pressed")).toBe("false");

    // Toggle to Active
    fireEvent.click(activeButton);
    expect(activeButton.getAttribute("aria-pressed")).toBe("true");
    expect(prospectButton.getAttribute("aria-pressed")).toBe("false");

    clickSubmit(/save customer \+ start project/i);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [, fetchOptions] = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body.project_status).toBe("active");
  });

  // ---------------------------------------------------------------------------
  // POST body safety
  // ---------------------------------------------------------------------------

  it("does not send is_archived in quick-add POST body", async () => {
    mockFetch.mockResolvedValueOnce(successResponse());

    render(<QuickAddConsole />);
    fillCustomerFields("Jane Doe", "5551234567");
    clickSubmit(/save customer only/i);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    const [, fetchOptions] = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchOptions.body);
    expect(body).not.toHaveProperty("is_archived");
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
