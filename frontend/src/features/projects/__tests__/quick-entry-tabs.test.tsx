import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/features/payments", () => ({
  PaymentRecorder: () => <div data-testid="payment-recorder">PaymentRecorder</div>,
}));

vi.mock("@/features/vendor-bills/components/quick-receipt", () => ({
  QuickReceipt: () => <div data-testid="quick-receipt">QuickReceipt</div>,
}));

import { QuickEntryTabs } from "../components/quick-entry-tabs";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QuickEntryTabs", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders payment tab by default", () => {
    render(<QuickEntryTabs projectId={1} authToken="test-token" allocationTargets={[]} />);

    expect(screen.getByTestId("payment-recorder")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-receipt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customer Payment" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Expense Receipt" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to receipt tab on click", () => {
    render(<QuickEntryTabs projectId={1} authToken="test-token" allocationTargets={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Expense Receipt" }));

    expect(screen.queryByTestId("payment-recorder")).not.toBeInTheDocument();
    expect(screen.getByTestId("quick-receipt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expense Receipt" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Customer Payment" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches back to payment tab from receipt", () => {
    render(<QuickEntryTabs projectId={1} authToken="test-token" allocationTargets={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Expense Receipt" }));
    fireEvent.click(screen.getByRole("button", { name: "Customer Payment" }));

    expect(screen.getByTestId("payment-recorder")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-receipt")).not.toBeInTheDocument();
  });
});
