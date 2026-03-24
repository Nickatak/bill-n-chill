import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/shared/session/use-shared-session", () => ({
  useSharedSessionAuth: vi.fn(() => ({
    token: "test-token",
    email: "nick@test.com",
    authMessage: "",
    role: "owner",
    organization: null,
    capabilities: {},
  })),
}));

vi.mock("@/shared/hooks/use-media-query", () => ({
  useMediaQuery: vi.fn(() => false),
}));

vi.mock("../components/invoices-tab", () => ({
  InvoicesTab: () => <div data-testid="invoices-tab">InvoicesTab</div>,
}));

vi.mock("../components/bills-tab", () => ({
  BillsTab: () => <div data-testid="bills-tab">BillsTab</div>,
}));

import { AccountingConsole } from "../components/accounting-console";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AccountingConsole", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders invoices tab by default", () => {
    render(<AccountingConsole />);

    expect(screen.getByTestId("invoices-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("bills-tab")).not.toBeInTheDocument();
  });

  it("switches to bills tab on click", () => {
    render(<AccountingConsole />);

    fireEvent.click(screen.getByRole("button", { name: "Bills" }));

    expect(screen.queryByTestId("invoices-tab")).not.toBeInTheDocument();
    expect(screen.getByTestId("bills-tab")).toBeInTheDocument();
  });

  it("shows auth notice when no token", async () => {
    const { useSharedSessionAuth } = await import("@/shared/session/use-shared-session");
    vi.mocked(useSharedSessionAuth).mockReturnValueOnce({
      token: "",
      email: "",
      authMessage: "",
      role: "viewer",
      organization: null,
      capabilities: {},
      isSuperuser: false,
      isImpersonating: false,
      impersonation: undefined,
    });

    render(<AccountingConsole />);

    expect(screen.getByText("Sign in to view accounting data.")).toBeInTheDocument();
    expect(screen.queryByTestId("invoices-tab")).not.toBeInTheDocument();
  });

  it("switches back to invoices from another tab", () => {
    render(<AccountingConsole />);

    fireEvent.click(screen.getByRole("button", { name: "Bills" }));
    expect(screen.getByTestId("bills-tab")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Invoices" }));
    expect(screen.getByTestId("invoices-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("bills-tab")).not.toBeInTheDocument();
  });
});
