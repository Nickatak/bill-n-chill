import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

import { QuickExpense } from "../components/quick-expense";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Respond to the GET /stores/ call that fires on mount. */
function mockStoresFetch() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ data: [] }),
  });
}

describe("QuickExpense", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockStoresFetch();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the form with store, amount, and notes fields", () => {
    render(
      <QuickExpense projectId={1} authToken="test-token" />,
    );

    expect(screen.getByPlaceholderText("e.g. Home Depot")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Optional")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log expense/i })).toBeInTheDocument();
  });

  it("shows field error when submitting with empty amount", () => {
    render(
      <QuickExpense projectId={1} authToken="test-token" />,
    );

    fireEvent.submit(screen.getByRole("button", { name: /log expense/i }).closest("form")!);

    expect(screen.getByText(/enter an amount/i)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the stores fetch
  });

  it("shows field error when amount is negative", () => {
    render(
      <QuickExpense projectId={1} authToken="test-token" />,
    );

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "-5" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /log expense/i }).closest("form")!);

    expect(screen.getByText(/must be greater than zero/i)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the stores fetch
  });

  it("clears amount field error when user types an amount", () => {
    render(
      <QuickExpense projectId={1} authToken="test-token" />,
    );

    // Trigger error
    fireEvent.submit(screen.getByRole("button", { name: /log expense/i }).closest("form")!);
    expect(screen.getByText(/enter an amount/i)).toBeInTheDocument();

    // Type an amount — error should clear
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "100" },
    });
    expect(screen.queryByText(/enter an amount/i)).not.toBeInTheDocument();
  });

  it("calls onExpenseCreated and resets form on success", async () => {
    const onCreated = vi.fn();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: 42,
            store_name: "Home Depot",
            total: "237.50",
            balance_due: "0.00",
            status: "open",
          },
        }),
    });

    render(
      <QuickExpense
        projectId={1}
        authToken="test-token"
        onExpenseCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. Home Depot"), {
      target: { value: "Home Depot" },
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "237.50" },
    });
    fireEvent.change(screen.getByPlaceholderText("Optional"), {
      target: { value: "Lumber run" },
    });
    fireEvent.click(screen.getByRole("button", { name: /log expense/i }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });

    // Verify the POST payload (call[0] is GET /stores/, call[1] is POST /expenses/)
    const [url, options] = mockFetch.mock.calls[1];
    expect(url).toContain("/projects/1/expenses/");
    const body = JSON.parse(options.body);
    expect(body.store_name).toBe("Home Depot");
    expect(body.total).toBe("237.50");
    expect(body.method).toBe("card");
    expect(body.notes).toBe("Lumber run");

    // Form should be reset
    expect((screen.getByPlaceholderText("e.g. Home Depot") as HTMLInputElement).value).toBe("");
    expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("");
  });

  it("shows error message on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: {
            code: "validation_error",
            message: "Total is required.",
          },
        }),
    });

    render(
      <QuickExpense projectId={1} authToken="test-token" />,
    );

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /log expense/i }));

    await waitFor(() => {
      expect(screen.getByText(/total is required/i)).toBeInTheDocument();
    });
  });

  it("submits without store name (optional field)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { id: 43, store_name: "", total: "50.00", balance_due: "0.00", status: "open" },
        }),
    });

    render(
      <QuickExpense projectId={1} authToken="test-token" />,
    );

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /log expense/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.store_name).toBe("");
    expect(body.total).toBe("50.00");
  });
});
