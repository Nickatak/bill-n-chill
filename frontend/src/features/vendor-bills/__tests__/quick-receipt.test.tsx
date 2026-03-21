import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/shared/date-format", async () => {
  const actual = await vi.importActual<typeof import("@/shared/date-format")>("@/shared/date-format");
  return {
    ...actual,
    todayDateInput: () => "2026-03-20",
  };
});

vi.stubGlobal("fetch", mockFetch);

import { QuickReceipt } from "../components/quick-receipt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderReceipt(props: Partial<React.ComponentProps<typeof QuickReceipt>> = {}) {
  return render(
    <QuickReceipt projectId={1} authToken="test-token" {...props} />,
  );
}

function setupPostResponse(ok: boolean, data: unknown) {
  mockFetch.mockResolvedValue({
    ok,
    json: () => Promise.resolve(ok ? { data } : { error: data }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuickReceipt", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders form with empty fields and today's date", () => {
    renderReceipt();

    expect(screen.getByText("Store")).toBeInTheDocument();
    expect(screen.getByText("Amount *")).toBeInTheDocument();
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record Receipt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan Receipt Photo" })).toBeInTheDocument();
  });

  it("submits receipt via POST and shows success message", async () => {
    setupPostResponse(true, { id: 1, amount: "42.50" });
    const onCreated = vi.fn();
    renderReceipt({ onReceiptCreated: onCreated });

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "42.50" },
    });

    fireEvent.submit(screen.getByRole("button", { name: "Record Receipt" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Receipt recorded.")).toBeInTheDocument();
    });

    // Callback fires on success
    expect(onCreated).toHaveBeenCalledTimes(1);

    // POST was sent to the correct endpoint
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/projects/1/receipts/"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows validation error for empty amount", async () => {
    renderReceipt();

    // Submit with default empty amount
    fireEvent.submit(screen.getByRole("button", { name: "Record Receipt" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Enter an amount.")).toBeInTheDocument();
    });

    // No fetch should have been made
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows API error on failed POST", async () => {
    setupPostResponse(false, { message: "Amount must be positive." });
    renderReceipt();

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "10.00" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Record Receipt" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Amount must be positive.")).toBeInTheDocument();
    });
  });

  it("shows network error on fetch rejection", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    renderReceipt();

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "10.00" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Record Receipt" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Network error recording receipt.")).toBeInTheDocument();
    });
  });

  it("resets form fields after successful submit", async () => {
    setupPostResponse(true, { id: 1 });
    renderReceipt();

    const amountInput = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    const storeInput = screen.getByPlaceholderText("e.g. Home Depot") as HTMLInputElement;

    fireEvent.change(amountInput, { target: { value: "99.99" } });
    fireEvent.change(storeInput, { target: { value: "Home Depot" } });

    fireEvent.submit(screen.getByRole("button", { name: "Record Receipt" }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText("Receipt recorded.")).toBeInTheDocument();
    });

    // Form fields should be reset
    expect(amountInput.value).toBe("");
    expect(storeInput.value).toBe("");
  });

  it("shows scanning state while scan is in progress", async () => {
    // Mock a scan that never resolves
    mockFetch.mockReturnValue(new Promise(() => {}));
    renderReceipt();

    const scanButton = screen.getByRole("button", { name: "Scan Receipt Photo" });

    // Simulate file selection via the hidden input
    const fileInput = scanButton.parentElement!.querySelector("input[type='file']")!;
    const file = new File(["fake"], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Scanning...")).toBeInTheDocument();
    });
  });

  it("prefills fields from successful scan response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: { store_name: "Lowes", amount: "87.50", receipt_date: "2026-03-15" },
      }),
    });
    renderReceipt();

    const scanButton = screen.getByRole("button", { name: "Scan Receipt Photo" });
    const fileInput = scanButton.parentElement!.querySelector("input[type='file']")!;
    const file = new File(["fake"], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("Prefilled 3 fields from photo.")).toBeInTheDocument();
    });

    expect((screen.getByPlaceholderText("e.g. Home Depot") as HTMLInputElement).value).toBe("Lowes");
    expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("87.50");
  });
});
