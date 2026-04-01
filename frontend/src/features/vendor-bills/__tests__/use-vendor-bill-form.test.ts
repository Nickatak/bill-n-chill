import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVendorBillForm } from "../hooks/use-vendor-bill-form";
import type { VendorBillRecord, VendorRecord } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeVendor(overrides: Partial<VendorRecord> = {}): VendorRecord {
  return {
    id: 1,
    name: "Acme Lumber",
    email: "acme@example.com",
    ...overrides,
  };
}

function makeVendorBill(overrides: Partial<VendorBillRecord> = {}): VendorBillRecord {
  return {
    id: 42,
    project: 7,
    project_name: "Kitchen Remodel",
    vendor: 1,
    vendor_name: "Acme Lumber",
    bill_number: "INV-001",
    status: "open",
    payment_status: "unpaid",
    received_date: "2026-03-01",
    issue_date: "2026-03-01",
    due_date: "2026-04-01",
    subtotal: "5000.00",
    tax_total: "100.00",
    shipping_total: "50.00",
    total: "5150.00",
    balance_due: "5150.00",
    allocations: [],
    line_items: [
      {
        id: 1,
        cost_code: null,
        cost_code_code: "",
        cost_code_name: "",
        description: "Lumber",
        quantity: "10",
        unit_price: "50.00",
        amount: "500.00",
      },
    ],
    notes: "Rush order",
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-01T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useVendorBillForm", () => {
  const defaultOptions = {
    isEditingMode: false,
    activeVendors: [makeVendor()],
  };

  it("starts with one empty line item in create mode", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    expect(result.current.formLineItems).toHaveLength(1);
    expect(result.current.formLineItems[0].description).toBe("");
    expect(result.current.formLineItems[0].quantity).toBe("1");
    expect(result.current.formLineItems[0].unit_price).toBe("");
  });

  it("computedSubtotal sums qty * unit_price across line items", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    act(() => {
      result.current.updateFormLineItem(0, { quantity: "3", unit_price: "10.00" });
    });

    expect(result.current.computedSubtotal).toBe(30);
  });

  it("computedTotal includes subtotal + tax + shipping", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    act(() => {
      result.current.updateFormLineItem(0, { quantity: "2", unit_price: "100.00" });
      result.current.setFormTaxAmount("25.00");
      result.current.setFormShippingAmount("15.00");
    });

    expect(result.current.computedSubtotal).toBe(200);
    expect(result.current.computedTotal).toBe(240);
  });

  it("addFormLineItem appends a blank row", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    act(() => {
      result.current.addFormLineItem();
    });

    expect(result.current.formLineItems).toHaveLength(2);
    expect(result.current.formLineItems[1].description).toBe("");
  });

  it("removeFormLineItem removes a row but keeps at least one", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    // Add a second row then remove the first
    act(() => {
      result.current.addFormLineItem();
      result.current.updateFormLineItem(0, { description: "First" });
      result.current.updateFormLineItem(1, { description: "Second" });
    });

    act(() => {
      result.current.removeFormLineItem(0);
    });

    expect(result.current.formLineItems).toHaveLength(1);
    expect(result.current.formLineItems[0].description).toBe("Second");

    // Trying to remove the last row should be a no-op
    act(() => {
      result.current.removeFormLineItem(0);
    });

    expect(result.current.formLineItems).toHaveLength(1);
  });

  it("hydrate populates edit-mode fields from a VendorBillRecord", () => {
    const { result, rerender } = renderHook(
      (props) => useVendorBillForm(props),
      { initialProps: { isEditingMode: true, activeVendors: [makeVendor()] } },
    );

    const bill = makeVendorBill();
    act(() => {
      result.current.hydrate(bill);
    });

    // Rerender so derived values recalculate with isEditingMode=true
    rerender({ isEditingMode: true, activeVendors: [makeVendor()] });

    expect(result.current.formVendorId).toBe("1");
    expect(result.current.formBillNumber).toBe("INV-001");
    expect(result.current.formIssueDate).toBe("2026-03-01");
    expect(result.current.formDueDate).toBe("2026-04-01");
    expect(result.current.formTaxAmount).toBe("100.00");
    expect(result.current.formShippingAmount).toBe("50.00");
    expect(result.current.formNotes).toBe("Rush order");
    expect(result.current.status).toBe("open");
    expect(result.current.formLineItems).toHaveLength(1);
    expect(result.current.formLineItems[0].description).toBe("Lumber");
  });

  it("populateCreateFromBill copies bill data into create-mode fields", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    const bill = makeVendorBill();
    act(() => {
      result.current.populateCreateFromBill(bill);
    });

    // In create mode, the form* accessors read from new* fields
    expect(result.current.formVendorId).toBe("1");
    expect(result.current.formBillNumber).toBe(""); // cleared for new bill number
    expect(result.current.formIssueDate).toBe("2026-03-01");
    expect(result.current.formDueDate).toBe("2026-04-01");
    expect(result.current.formTaxAmount).toBe("100.00");
    expect(result.current.formShippingAmount).toBe("50.00");
    expect(result.current.formNotes).toBe("Rush order");
    expect(result.current.formLineItems).toHaveLength(1);
    expect(result.current.formLineItems[0].description).toBe("Lumber");
    expect(result.current.duplicateCandidates).toHaveLength(0);
  });

  it("resetCreateForm clears create-mode fields to defaults", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    // Populate some data first
    act(() => {
      result.current.setFormBillNumber("INV-999");
      result.current.setFormNotes("Some notes");
      result.current.addFormLineItem();
      result.current.updateFormLineItem(0, { description: "Line A" });
    });

    act(() => {
      result.current.resetCreateForm();
    });

    expect(result.current.formBillNumber).toBe("");
    expect(result.current.formNotes).toBe("");
    expect(result.current.formLineItems).toHaveLength(1);
    expect(result.current.formLineItems[0].description).toBe("");
    // Vendor should be pre-selected from activeVendors
    expect(result.current.formVendorId).toBe("1");
  });

  it("unified setters route to create-mode fields when not editing", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    act(() => {
      result.current.setFormVendorId("5");
      result.current.setFormBillNumber("B-100");
      result.current.setFormReceivedDate("2026-06-01");
      result.current.setFormIssueDate("2026-06-01");
      result.current.setFormDueDate("2026-07-01");
      result.current.setFormTaxAmount("12.34");
      result.current.setFormShippingAmount("5.67");
      result.current.setFormNotes("Test note");
    });

    expect(result.current.formVendorId).toBe("5");
    expect(result.current.formBillNumber).toBe("B-100");
    expect(result.current.formReceivedDate).toBe("2026-06-01");
    expect(result.current.formIssueDate).toBe("2026-06-01");
    expect(result.current.formDueDate).toBe("2026-07-01");
    expect(result.current.formTaxAmount).toBe("12.34");
    expect(result.current.formShippingAmount).toBe("5.67");
    expect(result.current.formNotes).toBe("Test note");
  });

  it("unified setters route to edit-mode fields when editing", () => {
    const { result } = renderHook(() =>
      useVendorBillForm({ isEditingMode: true, activeVendors: [makeVendor()] }),
    );

    act(() => {
      result.current.setFormVendorId("9");
      result.current.setFormBillNumber("EDIT-100");
    });

    expect(result.current.formVendorId).toBe("9");
    expect(result.current.formBillNumber).toBe("EDIT-100");
    // The raw edit-mode fields should also reflect
    expect(result.current.vendorId).toBe("9");
    expect(result.current.billNumber).toBe("EDIT-100");
  });

  it("computedSubtotal handles multiple line items correctly", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    // Update first line, then add second line in separate acts to avoid
    // stale-closure conflicts (addFormLineItem reads formLineItems).
    act(() => {
      result.current.updateFormLineItem(0, { quantity: "5", unit_price: "20.00" });
    });

    act(() => {
      result.current.addFormLineItem();
    });

    act(() => {
      result.current.updateFormLineItem(1, { quantity: "3", unit_price: "15.00" });
    });

    // 5*20 + 3*15 = 100 + 45 = 145
    expect(result.current.computedSubtotal).toBe(145);
  });

  it("computedSubtotal handles non-numeric inputs gracefully", () => {
    const { result } = renderHook(() => useVendorBillForm(defaultOptions));

    act(() => {
      result.current.updateFormLineItem(0, { quantity: "abc", unit_price: "xyz" });
    });

    expect(result.current.computedSubtotal).toBe(0);
    expect(result.current.computedTotal).toBe(0);
  });
});
