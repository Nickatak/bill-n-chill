/**
 * Tests for the useInvoiceFormFields hook.
 *
 * Validates form field hydration from invoice records, workspace context
 * assignment (editing vs locked), and reset-to-blank-draft behavior.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInvoiceFormFields } from "../hooks/use-invoice-form-fields";
import type { InvoiceRecord, OrganizationInvoiceDefaults } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 20,
    project: 7,
    customer: 5,
    customer_display_name: "Jane Smith",
    invoice_number: "INV-0020",
    public_ref: "inv-abc-123",
    status: "draft",
    issue_date: "2026-02-01",
    due_date: "2026-03-03",
    sender_name: "Acme Construction",
    sender_email: "billing@acme.com",
    sender_address: "123 Main St",
    sender_logo_url: "",
    terms_text: "Net 30",
    footer_text: "",
    notes_text: "",
    subtotal: "3000.00",
    tax_percent: "8.25",
    tax_total: "247.50",
    total: "3247.50",
    balance_due: "3247.50",
    line_items: [
      {
        id: 1,
        cost_code: 50,
        description: "Foundation work",
        quantity: "1",
        unit: "lot",
        unit_price: "3000.00",
        line_total: "3000.00",
      },
    ],
    ...overrides,
  };
}

function makeOrgDefaults(overrides: Partial<OrganizationInvoiceDefaults> = {}): OrganizationInvoiceDefaults {
  return {
    id: 1,
    default_invoice_due_delta: 45,
    invoice_terms_and_conditions: "Net 45 — payment due within 45 days.",
    ...overrides,
  } as OrganizationInvoiceDefaults;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupHook(orgDefaults: OrganizationInvoiceDefaults | null = null) {
  const setLineItems = vi.fn();
  const setNextLineId = vi.fn();
  const resetLines = vi.fn();

  const result = renderHook(() =>
    useInvoiceFormFields({
      organizationInvoiceDefaults: orgDefaults,
      setLineItems,
      setNextLineId,
      resetLines,
    }),
  );

  return { ...result, mocks: { setLineItems, setNextLineId, resetLines } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useInvoiceFormFields", () => {
  describe("initial state", () => {
    it("initializes with today's date and default values", () => {
      const { result } = setupHook();

      // issueDate should be today in YYYY-MM-DD format
      expect(result.current.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.current.taxPercent).toBe("0");
      expect(result.current.termsText).toBe("");
      expect(result.current.workspaceSourceInvoiceId).toBeNull();
      expect(result.current.editingDraftInvoiceId).toBeNull();
      expect(result.current.workspaceContext).toBe("New invoice draft");
    });
  });

  describe("invoiceToWorkspaceLines", () => {
    it("maps API line items to InvoiceLineInput shape", () => {
      const { result } = setupHook();
      const invoice = makeInvoice();

      const lines = result.current.invoiceToWorkspaceLines(invoice);

      expect(lines).toHaveLength(1);
      expect(lines[0]).toEqual({
        localId: 1,
        costCode: "50",
        description: "Foundation work",
        quantity: "1",
        unit: "lot",
        unitPrice: "3000.00",
      });
    });

    it("returns a single empty line when invoice has no line items", () => {
      const { result } = setupHook();
      const invoice = makeInvoice({ line_items: [] });

      const lines = result.current.invoiceToWorkspaceLines(invoice);

      expect(lines).toHaveLength(1);
      expect(lines[0].costCode).toBe("");
      expect(lines[0].description).toBe("");
      expect(lines[0].localId).toBe(1);
    });

    it("handles null cost_code gracefully", () => {
      const { result } = setupHook();
      const invoice = makeInvoice({
        line_items: [
          {
            id: 1,
            cost_code: null,
            description: "Misc",
            quantity: "2",
            unit: "hr",
            unit_price: "75.00",
            line_total: "150.00",
          },
        ],
      });

      const lines = result.current.invoiceToWorkspaceLines(invoice);

      expect(lines[0].costCode).toBe("");
    });

    it("assigns sequential localIds for multiple lines", () => {
      const { result } = setupHook();
      const invoice = makeInvoice({
        line_items: [
          { id: 1, cost_code: 10, description: "A", quantity: "1", unit: "ea", unit_price: "100", line_total: "100" },
          { id: 2, cost_code: 20, description: "B", quantity: "2", unit: "hr", unit_price: "50", line_total: "100" },
          { id: 3, cost_code: 30, description: "C", quantity: "3", unit: "ls", unit_price: "200", line_total: "600" },
        ],
      });

      const lines = result.current.invoiceToWorkspaceLines(invoice);

      expect(lines.map((l) => l.localId)).toEqual([1, 2, 3]);
    });
  });

  describe("loadInvoiceIntoWorkspace", () => {
    it("hydrates form fields from a draft invoice and sets editing context", () => {
      const { result, mocks } = setupHook();
      const invoice = makeInvoice({ status: "draft" });

      act(() => {
        result.current.loadInvoiceIntoWorkspace(invoice);
      });

      expect(result.current.issueDate).toBe("2026-02-01");
      expect(result.current.dueDate).toBe("2026-03-03");
      expect(result.current.taxPercent).toBe("8.25");
      expect(result.current.termsText).toBe("Net 30");
      expect(result.current.workspaceSourceInvoiceId).toBe(20);
      expect(result.current.editingDraftInvoiceId).toBe(20);
      expect(result.current.workspaceContext).toBe("Editing INV-0020");
      expect(mocks.setLineItems).toHaveBeenCalledOnce();
      expect(mocks.setNextLineId).toHaveBeenCalledWith(2); // 1 line + 1
    });

    it("sets locked context for non-draft invoices", () => {
      const { result } = setupHook();
      const invoice = makeInvoice({ status: "sent" });

      act(() => {
        result.current.loadInvoiceIntoWorkspace(invoice);
      });

      expect(result.current.editingDraftInvoiceId).toBeNull();
      expect(result.current.workspaceContext).toBe("Viewing INV-0020 (locked)");
    });

    it("falls back to today's date when invoice dates are empty", () => {
      const { result } = setupHook();
      const invoice = makeInvoice({ issue_date: "", due_date: "" });

      act(() => {
        result.current.loadInvoiceIntoWorkspace(invoice);
      });

      // Should have valid date strings (today)
      expect(result.current.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.current.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("resetCreateDraft", () => {
    it("resets all fields to blank-draft defaults", () => {
      const { result, mocks } = setupHook();
      const invoice = makeInvoice();

      // First hydrate
      act(() => {
        result.current.loadInvoiceIntoWorkspace(invoice);
      });

      // Then reset
      act(() => {
        result.current.resetCreateDraft();
      });

      expect(result.current.taxPercent).toBe("0");
      expect(result.current.termsText).toBe("");
      expect(result.current.workspaceSourceInvoiceId).toBeNull();
      expect(result.current.editingDraftInvoiceId).toBeNull();
      expect(result.current.workspaceContext).toBe("New invoice draft");
      expect(mocks.resetLines).toHaveBeenCalled();
    });

    it("uses org defaults for terms text when available", () => {
      const orgDefaults = makeOrgDefaults();
      const { result } = setupHook(orgDefaults);
      const invoice = makeInvoice();

      // Hydrate then reset
      act(() => {
        result.current.loadInvoiceIntoWorkspace(invoice);
      });
      act(() => {
        result.current.resetCreateDraft();
      });

      expect(result.current.termsText).toBe("Net 45 — payment due within 45 days.");
    });
  });

  describe("setters", () => {
    it("exposes individual field setters", () => {
      const { result } = setupHook();

      act(() => {
        result.current.setIssueDate("2026-06-15");
        result.current.setDueDate("2026-07-15");
        result.current.setTaxPercent("10");
        result.current.setTermsText("Custom terms");
      });

      expect(result.current.issueDate).toBe("2026-06-15");
      expect(result.current.dueDate).toBe("2026-07-15");
      expect(result.current.taxPercent).toBe("10");
      expect(result.current.termsText).toBe("Custom terms");
    });
  });
});
